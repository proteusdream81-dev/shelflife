import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { BOOK_FORMATS } from "@/lib/bookMeta";
import CameraView from "@/components/tbr/CameraView";
import BookResultRow from "@/components/tbr/BookResultRow";
import { toScanBase64 } from "@/lib/scanImage";

const MODES = [
  { value: "barcode", label: "Barcode" },
  { value: "cover", label: "Cover photo" },
  { value: "isbn", label: "Type ISBN" },
];

export default function ScanBook({ shelves, defaultShelfId, onAdded }) {
  const [mode, setMode] = useState("barcode");
  const [shelfId, setShelfId] = useState(defaultShelfId || shelves[0]?.id || "");
  const [format, setFormat] = useState("paperback");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [manualIsbn, setManualIsbn] = useState("");
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState({});

  const clearResults = () => { setResults([]); setError(""); setNote(""); };
  const switchMode = (value) => { setMode(value); clearResults(); };

  const lookupIsbn = async (raw) => {
    const isbn = String(raw || "").replace(/[^0-9Xx]/g, "");
    if (!isbn) { setError("That didn't look like a book ISBN."); return; }
    setLoading(true);
    clearResults();
    try {
      const res = await base44.functions.invoke("searchBooks", { query: isbn, type: "isbn" });
      const books = res.data.books || [];
      setResults(books);
      if (!books.length) setNote(`No book found for ISBN ${isbn}.`);
    } catch {
      setError("We couldn't look that book up. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const identifyCover = async (blob) => {
    setLoading(true);
    clearResults();
    try {
      // The photo travels as bytes and the backend stores it itself, so nothing
      // here can ask for a signed link to someone else's file.
      const image = await toScanBase64(blob);
      const res = await base44.functions.invoke("identifyBook", { image });
      const books = res.data.books || [];
      const guess = res.data.guess || {};
      setResults(books);
      if (!books.length) {
        setNote(guess.title
          ? `We read "${guess.title}" but couldn't match it. Try the barcode, or type the ISBN.`
          : "We couldn't read a book in that photo. Try again with more light.");
      }
    } catch {
      setError("We couldn't read that photo. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const add = async (book) => {
    if (!shelfId) return;
    setAdding(book.google_books_id);
    try {
      await base44.entities.Book.create({
        title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
        description: book.description, publisher: book.publisher, published_date: book.published_date,
        page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
        google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read", format,
      });
      setAdded((a) => ({ ...a, [book.google_books_id]: true }));
      setNote(`Added "${book.title}" to your list.`);
      onAdded();
    } finally {
      setAdding("");
    }
  };

  const viewingResults = results.length > 0;
  const cameraActive = (mode === "barcode" || mode === "cover") && !loading && !viewingResults;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Add to</Label>
          <Select value={shelfId} onValueChange={setShelfId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOOK_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => switchMode(m.value)}
            className={`text-xs rounded-md py-1.5 transition-colors ${mode === m.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "isbn" ? (
        <div className="flex gap-2">
          <Input
            value={manualIsbn}
            onChange={(e) => setManualIsbn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookupIsbn(manualIsbn)}
            placeholder="e.g. 9780441013593"
            className="h-10"
          />
          <Button size="sm" onClick={() => lookupIsbn(manualIsbn)} disabled={loading}>Look up</Button>
        </div>
      ) : (
        <CameraView active={cameraActive} mode={mode} onBarcode={lookupIsbn} onCapture={identifyCover} />
      )}

      {mode === "cover" && !loading && !viewingResults && (
        <label className="flex items-center justify-center text-xs text-muted-foreground underline cursor-pointer">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) identifyCover(f); e.target.value = ""; }}
          />
          Choose a photo from your device instead
        </label>
      )}

      {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      {note && <p className="text-sm text-muted-foreground text-center">{note}</p>}

      {viewingResults && (
        <div className="max-h-72 overflow-y-auto space-y-2 -mx-1 px-1">
          {results.map((book) => (
            <BookResultRow
              key={book.google_books_id || book.isbn}
              book={book}
              onToggle={add}
              disabled={!!added[book.google_books_id]}
              busy={adding === book.google_books_id}
            />
          ))}
          <Button variant="ghost" size="sm" className="w-full" onClick={clearResults}>Scan another book</Button>
        </div>
      )}
    </div>
  );
}