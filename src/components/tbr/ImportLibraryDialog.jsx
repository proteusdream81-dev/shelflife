import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, Check } from "lucide-react";
import ImportStatusList from "@/components/tbr/ImportStatusList";
import { createBooks, applyBookPatches } from "@/lib/bookStore";
import {
  parseLibraryCsv, shelfSummary, toBookRecord, existingIndex, findExisting, metadataPatch,
} from "@/lib/libraryImport";

const ENRICH_BATCH = 12;
const CREATE_CHUNK = 200;

// Bringing a library across from wherever it has been kept — Goodreads, StoryGraph,
// LibraryThing or Bookmory. The reader's own status, rating and notes are kept as they are,
// and every book is then matched against the catalogues so it arrives with its metadata and
// cover rather than as a bare title.
export default function ImportLibraryDialog({ open, onOpenChange, shelves, onImported }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [statuses, setStatuses] = useState({});
  const [summary, setSummary] = useState(null);

  const reset = () => {
    setParsed(null);
    setFileName("");
    setPasted("");
    setError("");
    setSummary(null);
    setStatuses({});
    setProgress({ done: 0, total: 0 });
  };
  const close = (value) => { if (!value) reset(); onOpenChange(value); };

  // A chosen file and pasted text are the same export, so both go through one parser.
  const readExport = (text, label) => {
    setError("");
    setSummary(null);
    setStatuses({});
    try {
      const result = parseLibraryCsv(text);
      if (!result.books.length) {
        setParsed(null);
        setError("No books found there. Export your library from Goodreads, StoryGraph, LibraryThing or Bookmory and try again.");
        return;
      }
      setFileName(label);
      setParsed(result);
    } catch {
      setError("That couldn't be read. Please upload or paste the library export.");
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      readExport(await file.text(), file.name);
    } catch {
      setError("That file couldn't be read. Please upload the export again.");
    }
  };

  const runImport = async () => {
    if (!parsed?.books?.length || busy) return;
    setBusy(true);
    setError("");
    setSummary(null);

    const books = parsed.books;
    setStatuses(Object.fromEntries(books.map((book) => [book.key, "waiting"])));
    setProgress({ done: 0, total: books.length });

    try {
      // Every shelf the export names, made once if it isn't there already.
      const byName = new Map(shelves.map((shelf) => [shelf.name.trim().toLowerCase(), shelf]));
      const made = [];
      const shelfNames = [...new Set(books.map((book) => book.shelf_name))];
      for (const name of shelfNames) {
        const key = name.trim().toLowerCase();
        if (byName.has(key)) continue;
        const shelf = await base44.entities.Shelf.create({ name });
        byName.set(key, shelf);
        made.push(shelf);
      }
      const allShelves = [...shelves, ...made];

      // What the reader already has decides what is added and what is only filled in.
      const existing = [];
      let cursor;
      do {
        const page = await base44.entities.Book.filter({}, { limit: 200, cursor });
        existing.push(...(page.items || []));
        cursor = page.has_more ? page.next_cursor : undefined;
      } while (cursor);
      const index = existingIndex(existing);

      const records = [];
      const toCreate = [];
      books.forEach((book) => {
        const found = findExisting(book, index);
        if (found) records.push({ imported: book, record: found, duplicate: true });
        else toCreate.push(book);
      });

      for (let i = 0; i < toCreate.length; i += CREATE_CHUNK) {
        const chunk = toCreate.slice(i, i + CREATE_CHUNK);
        const created = await createBooks(
          chunk.map((book) => toBookRecord(book, byName.get(book.shelf_name.trim().toLowerCase()).id)),
          allShelves
        );
        chunk.forEach((book, position) => {
          records.push({ imported: book, record: created[position], duplicate: false });
        });
      }

      // Metadata and covers, a batch at a time, so the reader can watch it happen.
      const tally = { imported: toCreate.length, merged: 0, duplicates: 0, matched: 0, unmatched: 0, errors: 0 };
      const mark = (key, value) => setStatuses((prev) => ({ ...prev, [key]: value }));
      let checked = 0;

      for (let i = 0; i < records.length; i += ENRICH_BATCH) {
        const batch = records.slice(i, i + ENRICH_BATCH);
        let results = [];
        try {
          const res = await base44.functions.invoke("enrichBooks", {
            books: batch.map(({ imported }) => ({
              key: imported.key,
              title: imported.title,
              author: imported.author,
              isbn: imported.isbn,
            })),
          });
          results = res.data.results || [];
        } catch {
          batch.forEach(({ imported }) => mark(imported.key, "error"));
          tally.errors += batch.length;
          checked += batch.length;
          setProgress({ done: checked, total: records.length });
          continue;
        }

        const byKey = new Map(results.map((result) => [result.key, result]));
        const patches = [];
        batch.forEach(({ imported, record, duplicate }) => {
          const found = byKey.get(imported.key);
          if (!found?.matched) {
            mark(imported.key, duplicate ? "duplicate" : "unmatched");
            if (duplicate) tally.duplicates += 1;
            else tally.unmatched += 1;
            return;
          }
          const patch = metadataPatch(record, found.book);
          if (patch) patches.push(patch);
          if (duplicate) {
            mark(imported.key, patch ? "merged" : "duplicate");
            if (patch) tally.merged += 1;
            else tally.duplicates += 1;
          } else {
            mark(imported.key, "matched");
            tally.matched += 1;
          }
        });
        if (patches.length) await applyBookPatches(patches);
        checked += batch.length;
        setProgress({ done: checked, total: records.length });
      }

      setSummary({ ...tally, source: parsed.source, shelves: shelfNames });
      onImported();
    } catch (e) {
      setError(e?.message || "The import didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const counts = shelfSummary(parsed?.books || []);
  const unmatched = (parsed?.books || []).filter((book) => statuses[book.key] === "unmatched");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import your library</DialogTitle>
          <DialogDescription>
            Bring your shelves across from Goodreads, StoryGraph, LibraryThing or Bookmory — your
            ratings and reading status come with them, and each book is matched to its cover and
            details afterwards.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-primary">
              <Check className="w-4 h-4" />
              Added {summary.imported} {summary.imported === 1 ? "book" : "books"} from {summary.source}
            </div>

            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{summary.matched} arrived with their cover and details.</p>
              {summary.merged > 0 && (
                <p>{summary.merged} {summary.merged === 1 ? "book was" : "books were"} already in your list, and {summary.merged === 1 ? "its" : "their"} missing details were filled in.</p>
              )}
              {(summary.duplicates + summary.unmatched + summary.errors) > 0 && (
                <p>
                  {summary.duplicates + summary.unmatched + summary.errors} could not be matched to a catalogue entry.
                  {" "}They are on your shelves with the title, author and reading status your export gave them.
                </p>
              )}
            </div>

            {unmatched.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {unmatched.map((book) => (
                  <p key={book.key} className="px-3 py-2 text-sm truncate">{book.title}</p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {summary.shelves.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}
            </div>

            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        ) : parsed ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              Found <strong>{parsed.books.length}</strong> {parsed.books.length === 1 ? "book" : "books"} in {fileName}
              {parsed.source ? ` (${parsed.source})` : ""}.
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([name, count]) => (
                <Badge key={name} variant="secondary">{name}: {count}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Each book lands on the shelf its status names. Books you already have are kept as they
              are and their missing details filled in, so this can be re-run any time.
            </p>

            {busy && (
              <div className="space-y-3">
                <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                <p role="status" className="text-xs text-muted-foreground">
                  Matching {progress.done} of {progress.total} books...
                </p>
                <ImportStatusList books={parsed.books} statuses={statuses} />
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={runImport} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {busy ? "Importing..." : `Import ${parsed.books.length} ${parsed.books.length === 1 ? "book" : "books"}`}
              </Button>
              <Button variant="outline" onClick={reset} disabled={busy}>Start over</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-border rounded-lg py-8 cursor-pointer hover:bg-accent/40 transition-colors">
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose your library export</span>
              <span className="text-xs text-muted-foreground">CSV or TSV — any of the four services</span>
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                className="hidden"
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">
                Or paste the export instead — no file picker needed
              </p>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Paste the contents of your library export here..."
                aria-label="Paste your library export"
                className="h-28 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!pasted.trim()}
                onClick={() => readExport(pasted, "your pasted list")}
              >
                Read pasted list
              </Button>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to export your library</p>
              <p>Goodreads: My Books, then Import/Export, then Export Library.</p>
              <p>StoryGraph: Manage, then Export your data as a CSV.</p>
              <p>LibraryThing: Your library, then Import/Export, then the TSV export.</p>
              <p>Bookmory: Settings, then Export your library as a CSV.</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}