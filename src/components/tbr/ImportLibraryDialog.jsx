import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, Check, Layers } from "lucide-react";
import ImportStatusList from "@/components/tbr/ImportStatusList";
import { createBooks, applyBookPatches, defaultShelfId } from "@/lib/bookStore";
import {
  parseLibraryCsv, shelfSummary, toBookRecord, existingIndex, findExisting, metadataPatch,
  patchFilled,
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
  // What happens to a book the reader already has: the details it is missing get filled in,
  // or it is left exactly as it is.
  const [duplicateMode, setDuplicateMode] = useState("merge");
  const [duplicates, setDuplicates] = useState(null);
  // The records this import created, kept so a book whose lookup failed can be asked for again
  // without the reader running the whole file through a second time.
  const recordsRef = useRef([]);
  const [retrying, setRetrying] = useState("");

  // Everything already on the reader's shelves, so nothing is added twice.
  const loadLibrary = async () => {
    const all = [];
    let cursor;
    do {
      const page = await base44.entities.Book.filter({}, { limit: 200, cursor });
      all.push(...(page.items || []));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return all;
  };

  const reset = () => {
    setParsed(null);
    setFileName("");
    setPasted("");
    setError("");
    setSummary(null);
    setStatuses({});
    setDuplicates(null);
    setProgress({ done: 0, total: 0 });
  };
  const close = (value) => { if (!value) reset(); onOpenChange(value); };

  // A chosen file and pasted text are the same export, so both go through one parser.
  const readExport = async (text, label) => {
    setError("");
    setSummary(null);
    setStatuses({});
    setDuplicates(null);

    let result;
    try {
      result = parseLibraryCsv(text);
    } catch {
      setError("That couldn't be read. Please upload or paste the library export.");
      return;
    }
    if (!result.books.length) {
      setParsed(null);
      setError("No books found there. Export your library from Goodreads, StoryGraph, LibraryThing or Bookmory and try again.");
      return;
    }

    setFileName(label);
    setParsed(result);

    // How many of these the reader already has, so the choice offered below is an informed
    // one. The count is a courtesy: the import runs whether or not it can be worked out.
    try {
      const index = existingIndex(await loadLibrary());
      setDuplicates(result.books.filter((book) => findExisting(book, index)).length);
    } catch {
      setDuplicates(null);
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
      // Every shelf the export names — the reader's own bookshelves, and the shelves and
      // locations a library app keeps its copies on — is made once if it isn't there already,
      // so an imported library arrives with the structure it was kept in.
      const byName = new Map(shelves.map((shelf) => [shelf.name.trim().toLowerCase(), shelf]));
      const made = [];
      const shelfNames = [...new Set(books.map((book) => book.shelf_name).filter(Boolean))];
      for (const name of shelfNames) {
        const key = name.trim().toLowerCase();
        if (byName.has(key)) continue;
        const shelf = await base44.entities.Shelf.create({ name });
        byName.set(key, shelf);
        made.push(shelf);
      }
      const allShelves = [...shelves, ...made];
      // A row that named no shelf at all still lands somewhere rather than nowhere.
      const shelfIdForName = (name) =>
        byName.get(String(name || "").trim().toLowerCase())?.id || defaultShelfId(allShelves);

      // What the reader already has decides what is added and what is only filled in. Read
      // again here rather than reused from the preview, so a book added in the meantime is
      // recognised instead of arriving a second time.
      const index = existingIndex(await loadLibrary());

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
          chunk.map((book) => toBookRecord(book, shelfIdForName(book.shelf_name))),
          allShelves
        );
        chunk.forEach((book, position) => {
          records.push({ imported: book, record: created[position], duplicate: false });
        });
      }

      // Metadata and covers, a batch at a time, so the reader can watch it happen.
      const merge = duplicateMode === "merge";
      const tally = {
        imported: toCreate.length, merged: 0, duplicates: 0, skipped: 0,
        matched: 0, unmatched: 0, nocover: 0, errors: 0,
      };
      const mark = (key, value) => setStatuses((prev) => ({ ...prev, [key]: value }));
      let checked = 0;

      for (let i = 0; i < records.length; i += ENRICH_BATCH) {
        const batch = records.slice(i, i + ENRICH_BATCH);
        // A book the reader asked to leave as it is needs no lookup at all.
        const asked = batch.filter(({ duplicate }) => merge || !duplicate);
        let results = [];
        if (asked.length) {
          try {
            const res = await base44.functions.invoke("enrichBooks", {
              books: asked.map(({ imported }) => ({
                key: imported.key,
                title: imported.title,
                author: imported.author,
                isbn: imported.isbn,
                asin: imported.asin,
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
        }

        const byKey = new Map(results.map((result) => [result.key, result]));
        const patches = [];
        batch.forEach(({ imported, record, duplicate }) => {
          if (duplicate && !merge) {
            mark(imported.key, "duplicate");
            tally.skipped += 1;
            return;
          }
          const found = byKey.get(imported.key);
          if (!found?.matched) {
            mark(imported.key, duplicate ? "duplicate" : "unmatched");
            if (duplicate) tally.duplicates += 1;
            else tally.unmatched += 1;
            return;
          }
          const patch = metadataPatch(record, found.book, found.covers);
          if (patch) patches.push(patch);
          // A match that brought no cover leaves the book as a bare title on the shelf, so
          // it is reported rather than passing as a clean match.
          const covered = /^https?:\/\//.test(patch?.cover_url || record?.cover_url || "");
          if (!covered) tally.nocover += 1;
          const filled = patchFilled(patch);
          if (duplicate) {
            mark(imported.key, covered ? (filled ? "merged" : "duplicate") : "nocover");
            if (filled) tally.merged += 1;
            else tally.duplicates += 1;
          } else {
            tally.matched += 1;
            mark(imported.key, covered ? "matched" : "nocover");
          }
        });
        if (patches.length) await applyBookPatches(patches);
        checked += batch.length;
        setProgress({ done: checked, total: records.length });
      }

      recordsRef.current = records;
      setSummary({ ...tally, source: parsed.source, shelves: shelfNames });
      onImported();
    } catch (e) {
      setError(e?.message || "The import didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // One book's lookup, run again on its own. A catalogue that was briefly unreachable is the
  // usual reason a book arrived as a bare title, so asking again is worth a tap rather than a
  // second trip through the whole file.
  const retryBook = async (book) => {
    if (retrying) return;
    setRetrying(book.key);
    setError("");
    try {
      const res = await base44.functions.invoke("enrichBooks", {
        books: [{
          key: book.key,
          title: book.title,
          author: book.author,
          isbn: book.isbn,
          asin: book.asin,
        }],
      });
      const found = (res.data.results || [])[0];
      const record = recordsRef.current.find((entry) => entry.imported.key === book.key)?.record;
      if (!found?.matched || !record) {
        setStatuses((prev) => ({ ...prev, [book.key]: "unmatched" }));
        return;
      }
      const patch = metadataPatch(record, found.book, found.covers);
      if (patch) await applyBookPatches([patch]);
      const covered = /^https?:\/\//.test(patch?.cover_url || record.cover_url || "");
      setStatuses((prev) => ({ ...prev, [book.key]: covered ? "matched" : "nocover" }));
    } catch {
      setError("That lookup didn't come back. Please try again in a moment.");
    } finally {
      setRetrying("");
    }
  };

  const counts = shelfSummary(parsed?.books || []);
  // The books that need a look: nothing was found for them, the match brought no cover, or
  // the lookup itself could not be made.
  const needing = (parsed?.books || []).filter((book) =>
    ["unmatched", "nocover", "error"].includes(statuses[book.key])
  );

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
              {summary.skipped > 0 && (
                <p>{summary.skipped} {summary.skipped === 1 ? "book was" : "books were"} already in your list and left exactly as {summary.skipped === 1 ? "it was" : "they were"}.</p>
              )}
              {summary.nocover > 0 && (
                <p>{summary.nocover} {summary.nocover === 1 ? "book has" : "books have"} no cover yet — the catalogues had none to give.</p>
              )}
              {(summary.duplicates + summary.unmatched + summary.errors) > 0 && (
                <p>
                  {summary.duplicates + summary.unmatched + summary.errors} could not be matched to a catalogue entry.
                  {" "}They are on your shelves with the title, author and reading status your export gave them.
                </p>
              )}
            </div>

            {needing.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Worth a look</p>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {needing.map((book) => (
                    <div key={book.key} className="flex items-center gap-2 px-3 py-2">
                      <p className="min-w-0 flex-1 truncate text-sm">{book.title}</p>
                      <button
                        type="button"
                        onClick={() => retryBook(book)}
                        disabled={Boolean(retrying)}
                        className="vp-btn vp-small shrink-0"
                      >
                        {retrying === book.key ? <Loader2 className="animate-spin" /> : null}
                        {retrying === book.key ? "Looking..." : "Try again"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {summary.shelves.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}
            </div>

            <ImportStatusList books={parsed.books} statuses={statuses} />

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
              Each book lands on the shelf its status names, with the reading status and rating your
              export gave it. This can be re-run any time.
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

            {duplicates > 0 && !busy && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {duplicates} of these {duplicates === 1 ? "is" : "are"} already in your list. Nothing
                  is added twice — choose what happens to {duplicates === 1 ? "it" : "them"}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={duplicateMode === "merge"}
                    onClick={() => setDuplicateMode("merge")}
                    className={`vp-btn vp-small ${duplicateMode === "merge" ? "vp-active" : ""}`}
                  >
                    <Layers /> Fill in their missing details
                  </button>
                  <button
                    type="button"
                    aria-pressed={duplicateMode === "skip"}
                    onClick={() => setDuplicateMode("skip")}
                    className={`vp-btn vp-small ${duplicateMode === "skip" ? "vp-active" : ""}`}
                  >
                    <Check /> Leave them as they are
                  </button>
                </div>
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