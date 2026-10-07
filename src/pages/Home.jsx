import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Image } from "@/components/ui/image";
import { BookOpen, Plus, Search, Lock, Eye, EyeOff, Loader2, Library, Users, Download } from "lucide-react";
import { Link } from "react-router-dom";
import ShelfSection from "@/components/tbr/ShelfSection";
import AddBookDialog from "@/components/tbr/AddBookDialog";
import ShelfForm from "@/components/tbr/ShelfForm";
import ImportGoodreadsDialog from "@/components/tbr/ImportGoodreadsDialog";

const HERO_IMAGE = "https://media.base44.com/images/public/6ac5feeacf2ab847112ee3ed/611fd7a02_generated_7f9893bc.jpg";

export default function Home() {
  const [shelves, setShelves] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [shelfFormOpen, setShelfFormOpen] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-hero">
          <Image src={HERO_IMAGE} alt="" fittingType="fill" className="w-full h-full" />
        </div>
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <BookOpen strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>TBR</strong>
                <span>Your reading list</span>
              </div>
            </div>
            <div className="vp-actions">
              <button type="button" className="vp-btn" onClick={() => setShelfFormOpen(true)}>
                <Plus /> Shelf
              </button>
              <button type="button" className="vp-btn vp-primary" onClick={() => setAddOpen(true)}>
                <Plus /> Add book
              </button>
              <Link to="/friends" className="vp-btn vp-icon" title="Reading circle" aria-label="Reading circle">
                <Users strokeWidth={1.8} />
              </Link>
              <button
                type="button"
                className="vp-btn vp-icon"
                onClick={() => setImportOpen(true)}
                title="Import from Goodreads"
                aria-label="Import from Goodreads"
              >
                <Download strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <label className="vp-search">
            <Search />
            <Input
              placeholder="Search your list by title or author..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="vp-input"
            />
          </label>
        </div>
      </header>

      <main className="vp-main max-w-5xl mx-auto">
        {publicShelves.map((shelf) => (
          <ShelfSection key={shelf.id} shelf={shelf} books={booksForShelf(shelf.id)} allShelves={shelves} onChange={load} />
        ))}

        {privateShelves.length > 0 && (
          <>
            <button type="button" className="vp-privateToggle" onClick={() => setShowPrivate((v) => !v)}>
              <Lock strokeWidth={1.8} />
              <span>{showPrivate ? "Hide private shelves" : `Show private shelves (${privateShelves.length})`}</span>
              {showPrivate ? <EyeOff className="vp-eye" strokeWidth={1.8} /> : <Eye className="vp-eye" strokeWidth={1.8} />}
            </button>
            {showPrivate && privateShelves.map((shelf) => (
              <ShelfSection key={shelf.id} shelf={shelf} books={booksForShelf(shelf.id)} allShelves={shelves} onChange={load} isPrivate />
            ))}
          </>
        )}

        {shelves.length === 0 && (
          <div className="vp-empty">
            <Library className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No shelves yet. Create one to start adding books.</p>
          </div>
        )}
      </main>

      <AddBookDialog open={addOpen} onOpenChange={setAddOpen} shelves={shelves} onAdded={load} />
      <ShelfForm open={shelfFormOpen} onOpenChange={setShelfFormOpen} onSaved={load} />
      <ImportGoodreadsDialog open={importOpen} onOpenChange={setImportOpen} shelves={shelves} onImported={load} />
    </div>
  );
}