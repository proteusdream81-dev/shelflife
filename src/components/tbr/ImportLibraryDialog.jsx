import React, { useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, Check, Layers } from "lucide-react";
import ImportStatusList from "@/components/tbr/ImportStatusList";
import { createBooks, applyBookPatches, defaultShelfId } from "@/lib/bookStore";
import { fetchBooksEnrichmentDirect } from "@/lib/directBookCatalogue";
import {
  parseLibraryCsv, shelfPlan, shelfMatcher, shelfNamesFor, shelfMembershipPatch, toBookRecord,
  existingIndex, findExisting, metadataPatch, patchFilled,
} from "@/lib/libraryImport";

const ENRICH_BATCH = 12;
const CREATE_CHUNK = 200;

export default function ImportLibraryDialog({ open, onOpenChange, shelves, onImported }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [statuses, setStatuses] = useState({});
  const [summary, setSummary] = useState(null);
  const [duplicateMode, setDuplicateMode] = useState("merge");
  const [duplicates, setDuplicates] = useState(null);
  const recordsRef = useRef([]);
  const [retrying, setRetrying] = useState("");

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
      const matcher = shelfMatcher(shelves);
      const made = [];
      const landing = new Set();
      // Every shelf any book names — custom shelves and status shelves.
      const shelfNames = [...new Set(books.flatMap((book) => shelfNamesFor(book)))];
      for (const name of shelfNames) {
        if (matcher.find(name)) continue;
        const created = await base44.entities.Shelf.create({ name });
        const shelf = { ...created, name: created?.name || name, id: created?.id };
        made.push(matcher.remember(shelf));
      }
      const allShelves = [...shelves, ...made];
      const fallbackShelf = () =>
        allShelves.find((shelf) => shelf.id === defaultShelfId(allShelves)) || allShelves[0];
      const shelfIdForName = (name) => {
        const found = matcher.find(name) || fallbackShelf() || null;
        if (found?.name) landing.add(found.name);
        return found?.id || "";
      };
      shelfNames.forEach(shelfIdForName);
      const shelfIdsFor = (book) => [...new Set(shelfNamesFor(book).map(shelfIdForName).filter(Boolean))];

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
          chunk.map((book) => {
            const [main, ...others] = shelfIdsFor(book);
            return toBookRecord(book, main || shelfIdForName(book.shelf_name), others);
          }),
          allShelves,
          { checkDuplicates: false }
        );
        chunk.forEach((book, position) => {
          records.push({ imported: book, record: created[position], duplicate: false });
        });
      }

      const merge = duplicateMode === "merge";

      // Re-file existing books onto export shelves they are not yet on.
      if (merge) {
        const memberships = records
          .filter(({ duplicate }) => duplicate)
          .map(({ imported, record }) => shelfMembershipPatch(record, shelfIdsFor(imported)))
          .filter(Boolean);
        if (memberships.length) await applyBookPatches(memberships);
      }

      const tally = {
        imported: toCreate.length, merged: 0, duplicates: 0, skipped: 0,
        matched: 0, unmatched: 0, nocover: 0, errors: 0,
      };
      const mark = (key, value) => setStatuses((prev) => ({ ...prev, [key]: value }));
      let checked = 0;

      for (let i = 0; i < records.length; i += ENRICH_BATCH) {
        const batch = records.slice(i, i + ENRICH_BATCH);
        const asked = batch.filter(({ duplicate }) => merge || !duplicate);
        let results = [];
        if (asked.length) {
          try {
            const res = await fetchBooksEnrichmentDirect(asked.map(({ imported }) => ({
              key: imported.key,
              title: imported.title,
              author: imported.author,
              isbn: imported.isbn,
              asin: imported.asin,
            })));
            results = res.results || [];
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
      setSummary({ ...tally, source: parsed.source, shelves: [...landing] });
      onImported();
    } catch (e) {
      setError(e?.message || "The import didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const retryBook = async (book) => {
    if (retrying) return;
    setRetrying(book.key);
    setError("");
    try {
      const res = await fetchBooksEnrichmentDirect([{
        key: book.key,
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        asin: book.asin,
      }]);
      const found = (res.results || [])[0];
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

  const plan = useMemo(
    () => (parsed?.books?.length ? shelfPlan(parsed.books, shelves) : []),
    [parsed, shelves]
  );
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
                <p>{summary.merged} already in your list had missing details filled in.</p>
              )}
              {summary.skipped > 0 && (
                <p>{summary.skipped} already in your list were left as they were.</p>
              )}
              {summary.nocover > 0 && (
                <p>{summary.nocover} have no cover yet.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.shelves.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}
            </div>
            <ImportStatusList books={parsed.books} statuses={statuses} />
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        ) : parsed ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              Found <strong>{parsed.books.length}</strong> books in {fileName}
              {parsed.source ? ` (${parsed.source})` : ""}.
            </p>
            <div className="space-y-1 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">Where they land</p>
              {plan.map((entry) => (
                <p key={entry.name} className="text-xs text-muted-foreground">
                  {entry.count} on {entry.isNew ? `a new shelf named ${entry.name}` : `your ${entry.existing} shelf`}
                </p>
              ))}
            </div>
            {busy && (
              <div className="space-y-3">
                <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">Matching {progress.done} of {progress.total}...</p>
              </div>
            )}
            {duplicates > 0 && !busy && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {duplicates} already in your list. Choose what happens to them.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setDuplicateMode("merge")} className={`vp-btn vp-small ${duplicateMode === "merge" ? "vp-active" : ""}`}>
                    <Layers /> Fill in missing details
                  </button>
                  <button type="button" onClick={() => setDuplicateMode("skip")} className={`vp-btn vp-small ${duplicateMode === "skip" ? "vp-active" : ""}`}>
                    <Check /> Leave as they are
                  </button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={runImport} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {busy ? "Importing..." : `Import ${parsed.books.length} books`}
              </Button>
              <Button variant="outline" onClick={reset} disabled={busy}>Start over</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 cursor-pointer hover:bg-muted/40">
              <Upload className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm">Upload a CSV export</span>
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
            <p className="text-xs text-center text-muted-foreground">or paste the export below</p>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste your library CSV here..."
              className="min-h-[120px] font-mono text-xs"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button
              className="w-full"
              disabled={!pasted.trim()}
              onClick={() => readExport(pasted, "pasted text")}
            >
              Read paste
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
