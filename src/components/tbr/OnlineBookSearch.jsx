import React, { useCallback, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import BookSearchForm from "@/components/tbr/BookSearchForm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import BookResultRow from "@/components/tbr/BookResultRow";
import { BOOK_FORMATS } from "@/lib/bookMeta";
import { ownedIndex, isOwned } from "@/lib/ownedBooks";
import useBookFormats from "@/hooks/useBookFormats";

const keyOf = (book) => book.google_books_id || book.isbn || book.title;

const toRecord = (book, shelfId, format) => ({
  title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
  description: book.description, publisher: book.publisher, published_date: book.published_date,
  page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
  google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read", format,
  ...(book.series_name ? { series_name: book.series_name, series_position: book.series_position || "" } : {}),
});

export default function OnlineBookSearch({ shelves, defaultShelfId, onAdded, books = [] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [shelfId, setShelfId] = useState(defaultShelfId || shelves[0]?.id || "");
  const [format, setFormat] = useState("paperback");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [added, setAdded] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const searchingRef = useRef(false);
  const addingRef = useRef(false);
  const { formats, load: loadFormats } = useBookFormats();
  const owned = useMemo(() => ownedIndex(books), [books]);

  const search = async () => {
    if (!query.trim() || searchingRef.current || addingRef.current) return;
    searchingRef.current = true;
    setLoading(true);
    setSearched(true);
    setError("");
    setSaveError("");
    setMessage("");
    setResults([]);
    setSelected(new Set());
    try {
      const res = await base44.functions.invoke("searchBooks", { query: query.trim(), type });
      setResults(res.data.books || []);
    } catch {
      setResults([]);
      setError("Book search isn't responding right now. Please try again in a moment.");
    } finally {
      searchingRef.current = false;
      setLoading(false);
    }
  };

  // Held steady so typing in the search box doesn't redraw every result row.
  const toggle = useCallback((book) => {
    if (searchingRef.current || addingRef.current) return;
    setMessage("");
    setSaveError("");
    const key = keyOf(book);
    if (selected.has(key)) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }

    setSelected((prev) => new Set(prev).add(key));
    // Picking a book is when the reader wants to know which editions exist.
    loadFormats(book);
  }, [selected, loadFormats]);

  const addSelected = async () => {
    if (!shelfId || selected.size === 0 || addingRef.current || searchingRef.current) return;
    const chosen = results.filter((book) => selected.has(keyOf(book)) && !added.has(keyOf(book)) && !isOwned(book, owned));
    if (!chosen.length) return;
    addingRef.current = true;
    setAdding(true);
    setSaveError("");
    setMessage("");
    try {
      await base44.entities.Book.bulkCreate(chosen.map((book) => toRecord(book, shelfId, format)));
      setAdded((prev) => new Set([...prev, ...chosen.map(keyOf)]));
      setSelected(new Set());
      const shelfName = shelves.find((shelf) => shelf.id === shelfId)?.name || "your shelf";
      setMessage(`Added ${chosen.length} ${chosen.length === 1 ? "book" : "books"} to ${shelfName}.`);
    } catch {
      setSaveError("We couldn't add those books. Your selection is still here. Please try Add again.");
      return;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
    onAdded(chosen.length, shelfId);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <BookSearchForm query={query} onQueryChange={setQuery} type={type} onTypeChange={setType} loading={loading} disabled={loading || adding} onSearch={search} />
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Add to</Label>
          <Select value={shelfId} onValueChange={setShelfId} disabled={adding}>
            <SelectTrigger aria-label="Add to shelf"><SelectValue /></SelectTrigger>
            <SelectContent>
              {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Format</Label>
          <Select value={format} onValueChange={setFormat} disabled={adding}>
            <SelectTrigger aria-label="Book format"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOOK_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {message && <p role="status" className="shrink-0 text-sm text-primary">{message}</p>}
      {saveError && <p role="alert" className="shrink-0 text-sm text-destructive">{saveError}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1" aria-busy={loading || adding}>
        {loading && <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Searching books...</div>}
        {!loading && error && <p className="text-sm text-destructive text-center py-6">{error}</p>}
        {!loading && !error && searched && results.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No books found. Try a different search.</p>}
        {results.map((book) => (
          <BookResultRow
            key={keyOf(book)}
            book={book}
            selected={selected.has(keyOf(book))}
            disabled={added.has(keyOf(book))}
            busy={adding && selected.has(keyOf(book))}
            interactionDisabled={adding}
            owned={isOwned(book, owned)}
            formats={formats[keyOf(book)]}
            onToggle={toggle}
          />
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
          <span role="status" className="text-sm">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setSelected(new Set())} disabled={adding}>Clear</Button>
            <Button type="button" size="sm" className="min-h-11" onClick={addSelected} disabled={adding || !shelfId}>
              {adding ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : `Add ${selected.size} ${selected.size === 1 ? "book" : "books"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}