import React, { useMemo, useRef, useState } from "react";
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
import { ownedIndex, isOwned } from "@/lib/ownedBooks";
import useBookFormats from "@/hooks/useBookFormats";

const keyOf = (book) => book.google_books_id || book.isbn || `${book.title}|${book.author || ""}`;

const MODES = [
  { value: "barcode", label: "Barcode" },
  { value: "cover", label: "Cover photo" },
  { value: "isbn", label: "Type ISBN" },
];

export default function ScanBook({ shelves, defaultShelfId, onAdded, books = [] }) {
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
  const lookupRef = useRef(false);
  const addingRef = useRef(false);

  const { formats, load: loadFormats } = useBookFormats();
  const owned = useMemo(() => ownedIndex(books), [books]);

  const clearResults = () => { setResults([]); setError(""); setNote(""); };
  const switchMode = (value) => { setMode(value); clearResults(); };

  const lookupIsbn = async (raw) => {
    if (lookupRef.current || addingRef.current) return;
    const isbn = String(raw || "").replace(/[^0-9Xx]/g, "");
    if (!/^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) { setError("Enter a 10- or 13-digit book ISBN."); return; }
    lookupRef.current = true;
    setLoading(true);
    clearResults();
    try {
      const res = await base44.functions.invoke("searchBooks", { query: isbn, type: "isbn" });
      const books = res.data.books || [];
      setResults(books);
      loadFormats(books);
      if (!books.length) setNote(`No book found for ISBN ${isbn}.`);
    } catch {
      setError("We couldn't look that book up. Please try again.");
    } finally {
      lookupRef.current = false;
      setLoading(false);
    }
  };

  const identifyCover = async (blob) => {
    if (lookupRef.current || addingRef.current) return;
    lookupRef.current = true;
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
      loadFormats(books);
      if (!books.length) {
        setNote(guess.title
          ? `We read "${guess.title}" but couldn't match it. Try the barcode, or type the ISBN.`
          : "We couldn't read a book in that photo. Try again with more light.");
      }
    } catch {
      setError("We couldn't read that photo. Please try again.");
    } finally {
      lookupRef.current = false;
      setLoading(false);
    }
  };

  const add = async (book) => {
    const key = keyOf(book);
    if (!shelfId || addingRef.current || added[key] || isOwned(book, owned)) return;
    addingRef.current = true;
    setAdding(key);
    setError("");
    try {
      await base44.entities.Book.create({
        title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
        description: book.description, publisher: book.publisher, published_date: book.published_date,
        page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
        google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read", format,
        ...(book.series_name ? { series_name: book.series_name, series_position: book.series_position || "" } : {}),
      });
      setAdded((a) => ({ ...a, [key]: true }));
      setNote(`Added "${book.title}" to your list.`);
    } catch {
      setError("We couldn't add this book. Please try again.");
      return;
    } finally {
      addingRef.current = false;
      setAdding("");
    }
    onAdded(1, shelfId);
  };

  const viewingResults = results.length > 0;
  const cameraActive = (mode === "barcode" || mode === "cover") && !loading && !viewingResults;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Add to</Label>
          <Select value={shelfId} onValueChange={setShelfId} disabled={!!adding}>
            <SelectTrigger aria-label="Add to shelf"><SelectValue /></SelectTrigger>
            <SelectContent>
              {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Format</Label>
          <Select value={format} onValueChange={setFormat} disabled={!!adding}>
            <SelectTrigger aria-label="Book format"><SelectValue /></SelectTrigger>
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
            disabled={loading || !!adding}
            aria-pressed={mode === m.value}
            className={`min-h-11 text-xs rounded-md py-1.5 transition-colors disabled:opacity-50 ${mode === m.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "isbn" ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookupIsbn(manualIsbn); }}>
          <Input
            value={manualIsbn}
            onChange={(e) => setManualIsbn(e.target.value)}
            enterKeyHint="search"
            placeholder="e.g. 9780441013593"
            disabled={loading}
            enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupIsbn(manualIsbn); } }}
            className="h-11 min-w-0 flex-1"
          />
          <Button type="submit" size="sm" className="h-11 shrink-0" disabled={loading} onClick={(e) => e.preventDefault()}>{loading ? "Looking up..." : "Look up"}</Button>
        </form>
      ) : cameraActive ? (
        <CameraView active={cameraActive} mode={mode} onBarcode={lookupIsbn} onCapture={identifyCover} />
      ) : null}

      {mode === "cover" && !loading && !viewingResults && (
        <label className="flex min-h-11 items-center justify-center rounded-md border border-input px-3 text-center text-sm text-foreground cursor-pointer">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) identifyCover(f); e.target.value = ""; }}
          />
          Choose a photo from your device instead
        </label>
      )}

      {loading && <div role="status" className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" />{mode === "cover" ? "Reading your cover..." : "Looking up your book..."}</div>}
      {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
      {note && <p role="status" className="text-sm text-muted-foreground text-center">{note}</p>}

      {viewingResults && (
        <div className="max-h-72 overflow-y-auto space-y-2 -mx-1 px-1">
          {results.map((book) => (
            <BookResultRow
              key={keyOf(book)}
              book={book}
              onToggle={add}
              disabled={!!added[keyOf(book)]}
              busy={adding === keyOf(book)}
              interactionDisabled={!!adding || !shelfId}
              owned={isOwned(book, owned)}
              formats={formats[book.google_books_id || book.isbn || book.title]}
            />
          ))}
          <Button variant="ghost" size="sm" className="w-full" onClick={clearResults}>Scan another book</Button>
        </div>
      )}
    </div>
  );
}