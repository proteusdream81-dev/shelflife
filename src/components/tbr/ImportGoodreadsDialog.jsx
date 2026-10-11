import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { parseGoodreadsCsv, shelfSummary, bookKey } from "@/lib/goodreadsImport";

export default function ImportGoodreadsDialog({ open, onOpenChange, shelves, onImported }) {
  const [books, setBooks] = useState([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  const reset = () => { setBooks([]); setFileName(""); setSummary(null); setError(""); setPasted(""); setShowPaste(false); };
  const close = (value) => { if (!value) reset(); onOpenChange(value); };

  // A chosen file and pasted text are the same export, so both go through one parser.
  const readExport = (text, label) => {
    setError("");
    setSummary(null);
    try {
      const parsed = parseGoodreadsCsv(text);
      setFileName(label);
      if (!parsed.length) {
        setBooks([]);
        setError("No books found there. Export your library from Goodreads and try again.");
        return;
      }
      setBooks(parsed);
    } catch {
      setError("That couldn't be read. Please upload or paste the CSV from Goodreads.");
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      readExport(await file.text(), file.name);
    } catch {
      setError("That file couldn't be read. Please upload the CSV from Goodreads.");
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError("");
    try {
      const byName = {};
      shelves.forEach((s) => { byName[s.name.trim().toLowerCase()] = s; });

      const shelfNames = [...new Set(books.map((b) => b.shelf_name))];
      for (const name of shelfNames) {
        const key = name.trim().toLowerCase();
        if (!byName[key]) byName[key] = await base44.entities.Shelf.create({ name });
      }

      const current = await base44.entities.Book.list();
      const have = new Set(current.map(bookKey));
      const toAdd = books.filter((b) => !have.has(bookKey(b)));

      const payloads = toAdd.map((b) => {
        const { shelf_name, status, ...rest } = b;
        return { ...rest, shelf_id: byName[shelf_name.trim().toLowerCase()].id, status };
      });

      for (let i = 0; i < payloads.length; i += 200) {
        await base44.entities.Book.bulkCreate(payloads.slice(i, i + 200));
      }

      setSummary({ imported: payloads.length, skipped: books.length - payloads.length, shelves: shelfNames });
      onImported();
    } catch (e) {
      setError(e?.message || "The import didn't finish. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const counts = shelfSummary(books);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Goodreads</DialogTitle>
          <DialogDescription>
            Bring your Goodreads library across — shelves, ratings, reviews and covers included.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <Check className="w-4 h-4" />
              Added {summary.imported} {summary.imported === 1 ? "book" : "books"}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.shelves.map((name) => <Badge key={name} variant="secondary">{name}</Badge>)}
            </div>
            {summary.skipped > 0 && (
              <p className="text-xs text-muted-foreground">
                {summary.skipped} {summary.skipped === 1 ? "book was" : "books were"} already in your list, so they were left alone.
              </p>
            )}
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        ) : books.length > 0 ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              Found <strong>{books.length}</strong> {books.length === 1 ? "book" : "books"} in {fileName}.
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([name, n]) => (
                <Badge key={name} variant="secondary">{name}: {n}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Each book lands on its main Goodreads shelf. Custom Goodreads shelves aren't imported.
              Books you already have are skipped, so you can re-run this any time.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={runImport} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Import {books.length} {books.length === 1 ? "book" : "books"}
              </Button>
              <Button variant="outline" onClick={reset} disabled={busy}>Start over</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-border rounded-lg py-8 cursor-pointer hover:bg-accent/40 transition-colors">
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose your Goodreads CSV</span>
              <span className="text-xs text-muted-foreground">goodreads_library_export.csv</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>

            <div className="space-y-2">
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => setShowPaste((v) => !v)}
              >
                {showPaste ? "Hide the paste box" : "No file picker? Paste your export instead"}
              </button>
              {showPaste && (
                <>
                  <Textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="Paste the contents of goodreads_library_export.csv here..."
                    className="h-28 text-xs"
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!pasted.trim()}
                    onClick={() => readExport(pasted, "your pasted list")}
                  >
                    Read pasted list
                  </Button>
                </>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to get the file</p>
              <p>1. On Goodreads, open My Books.</p>
              <p>2. Click Import/Export, then Export Library.</p>
              <p>3. Upload the CSV it downloads here.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}