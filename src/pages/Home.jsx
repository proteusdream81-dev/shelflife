import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Plus, Search, Lock, Eye, EyeOff, Loader2, Library } from "lucide-react";
import ShelfSection from "@/components/tbr/ShelfSection";
import AddBookDialog from "@/components/tbr/AddBookDialog";
import ShelfForm from "@/components/tbr/ShelfForm";

export default function Home() {
  const [shelves, setShelves] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [shelfFormOpen, setShelfFormOpen] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let s = await base44.entities.Shelf.list("-created_date");
      if (s.length === 0) {
        const created = await base44.entities.Shelf.create({ name: "To Read" });
        s = [created];
      }
      const b = await base44.entities.Book.list("-created_date");
      setShelves(s);
      setBooks(b);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredBooks = useMemo(() => {
    if (!search.trim()) return books;
    const q = search.toLowerCase();
    return books.filter((b) =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.author || "").toLowerCase().includes(q) ||
      (b.isbn || "").toLowerCase().includes(q)
    );
  }, [books, search]);

  const publicShelves = shelves.filter((s) => !s.is_private);
  const privateShelves = shelves.filter((s) => s.is_private);
  const booksForShelf = (id) => filteredBooks.filter((b) => b.shelf_id === id);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight leading-none">TBR</h1>
                <p className="text-xs text-muted-foreground">Your reading list</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShelfFormOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Shelf
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add book
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search your list by title or author..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11"
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {publicShelves.map((shelf) => (
          <ShelfSection key={shelf.id} shelf={shelf} books={booksForShelf(shelf.id)} allShelves={shelves} onChange={load} />
        ))}

        {privateShelves.length > 0 && (
          <section>
            <button
              onClick={() => setShowPrivate((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <Lock className="w-4 h-4" />
              {showPrivate ? "Hide private shelves" : `Show private shelves (${privateShelves.length})`}
              {showPrivate ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            {showPrivate && (
              <div className="space-y-8">
                {privateShelves.map((shelf) => (
                  <ShelfSection key={shelf.id} shelf={shelf} books={booksForShelf(shelf.id)} allShelves={shelves} onChange={load} isPrivate />
                ))}
              </div>
            )}
          </section>
        )}

        {shelves.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Library className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No shelves yet. Create one to start adding books.</p>
          </div>
        )}
      </main>

      <AddBookDialog open={addOpen} onOpenChange={setAddOpen} shelves={shelves} onAdded={load} />
      <ShelfForm open={shelfFormOpen} onOpenChange={setShelfFormOpen} onSaved={load} />
    </div>
  );
}