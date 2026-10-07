import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image } from "@/components/ui/image";
import { Search, Loader2, Plus } from "lucide-react";

export default function OnlineBookSearch({ shelves, defaultShelfId, onAdded }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [shelfId, setShelfId] = useState(defaultShelfId || shelves[0]?.id || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await base44.functions.invoke("searchBooks", { query, type });
      setResults(res.data.books || []);
    } catch {
      setResults([]);
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
        google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read",
      });
      onAdded();
    } finally {
      setAdding(null);
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
          <div key={book.google_books_id} className="flex gap-3 p-2 rounded-lg border border-border hover:bg-accent/50 transition-colors">
            <div className="w-10 shrink-0 aspect-[2/3] rounded bg-muted overflow-hidden">
              {book.cover_url && <Image src={book.cover_url} alt="" fittingType="fill" className="w-full h-full" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium line-clamp-1">{book.title}</p>
              <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
              {book.publisher && <p className="text-xs text-muted-foreground line-clamp-1">{book.publisher} · {book.published_date}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={() => add(book)} disabled={adding === book.google_books_id || !shelfId}>
              {adding === book.google_books_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}