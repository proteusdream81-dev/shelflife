import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";
import BookResultRow from "@/components/tbr/BookResultRow";

const keyOf = (book) => book.google_books_id || book.isbn || book.title;

const toRecord = (book, shelfId) => ({
  title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
  description: book.description, publisher: book.publisher, published_date: book.published_date,
  page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
  google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read",
});

export default function OnlineBookSearch({ shelves, defaultShelfId, onAdded }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [shelfId, setShelfId] = useState(defaultShelfId || shelves[0]?.id || "");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [added, setAdded] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setSelected(new Set());
    try {
      const res = await base44.functions.invoke("searchBooks", { query, type });
      setResults(res.data.books || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (book) => {
    const key = keyOf(book);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelected = async () => {
    if (!shelfId || selected.size === 0) return;
    setAdding(true);
    try {
      const chosen = results.filter((b) => selected.has(keyOf(b)));
      await base44.entities.Book.bulkCreate(chosen.map((b) => toRecord(b, shelfId)));
      setAdded((prev) => new Set([...prev, ...chosen.map(keyOf)]));
      setSelected(new Set());
      onAdded();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Title, author or ISBN..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} className="pl-9 h-10" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-28 h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="author">Author</SelectItem>
            <SelectItem value="isbn">ISBN</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Add to</Label>
        <Select value={shelfId} onValueChange={setShelfId}>
          <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={search} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}</Button>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-2 -mx-1 px-1">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {!loading && searched && results.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No books found. Try a different search.</p>}
        {results.map((book) => (
          <BookResultRow
            key={keyOf(book)}
            book={book}
            selected={selected.has(keyOf(book))}
            disabled={added.has(keyOf(book))}
            onToggle={toggle}
          />
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
          <span className="text-sm">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" onClick={addSelected} disabled={adding || !shelfId}>
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : `Add ${selected.size} ${selected.size === 1 ? "book" : "books"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}