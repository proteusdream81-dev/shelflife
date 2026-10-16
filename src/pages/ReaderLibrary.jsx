import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SharedBookRow from "@/components/tbr/SharedBookRow";
import { createBook, defaultShelfId } from "@/lib/bookStore";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";

export default function ReaderLibrary() {
  const { readerId } = useParams();
  const location = useLocation();
  const [name, setName] = useState(location.state?.name || "");
  const [shelves, setShelves] = useState([]);
  const [sharedBooks, setSharedBooks] = useState([]);
  const [myShelves, setMyShelves] = useState([]);
  const [shelfId, setShelfId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [mine, res] = await Promise.all([
          base44.entities.Shelf.list("-created_date"),
          base44.functions.invoke("readingCircle", { action: "library", user_id: readerId }),
        ]);
        if (!active) return;
        setMyShelves(mine);
        setShelfId(defaultShelfId(mine));
        setShelves(res.data.shelves || []);
        setSharedBooks(res.data.shared_books || []);
      } catch (e) {
        if (!active) return;
        setError(
          e?.response?.data?.error ||
          e?.data?.error ||
          "You can only browse shelves from readers you follow who have shared them."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [readerId]);

  // Opened straight from a URL: resolve the reader's name for the header.
  useEffect(() => {
    if (name) return;
    base44.functions.invoke("readingCircle", { action: "overview" })
      .then((res) => {
        const all = [...(res.data.following || []), ...(res.data.followers || [])];
        const match = all.find((r) => r.id === readerId);
        if (match) setName(match.name);
      })
      .catch(() => {});
  }, [name, readerId]);

  const add = async (book) => {
    if (!shelfId) return;
    const key = `${book.isbn}|${book.title}`;
    setAdding(key);
    try {
      await createBook({
        title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
        description: book.description, publisher: book.publisher, published_date: book.published_date,
        page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
        google_books_id: book.google_books_id, shelf_id: shelfId,
        ...(book.format ? { format: book.format, formats: [book.format] } : {}),
        ...(book.series_name ? { series_name: book.series_name, series_position: book.series_position || "" } : {}),
        // The copy keeps whatever enrichment the shared book already carries.
        ...(book.community_rating > 0 ? { community_rating: book.community_rating } : {}),
        ...(book.community_ratings_count > 0 ? { community_ratings_count: book.community_ratings_count } : {}),
        ...(book.hardcover_id ? { hardcover_id: String(book.hardcover_id) } : {}),
      }, myShelves);
      setAdded((a) => ({ ...a, [key]: true }));
    } finally {
      setAdding("");
    }
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark"><Users strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong className="truncate">{name || "Reader"}</strong>
                <span>Shared shelves</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <Link to="/friends" className="vp-btn vp-small" aria-label="Back to the reading circle">
                <ArrowLeft /> Reading circle
              </Link>
              <h2 className="truncate">{name ? `${name}'s shelves` : "Shared shelves"}</h2>
            </div>
          </div>

          {!loading && !error && myShelves.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Add to my</Label>
              <Select value={shelfId} onValueChange={setShelfId}>
                <SelectTrigger className="h-11 sm:h-9 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {myShelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && <p className="vp-empty">{error}</p>}

          {!loading && !error && shelves.length === 0 && sharedBooks.length === 0 && (
            <p className="vp-empty">
              {name ? `${name} hasn't shared anything yet.` : "This reader hasn't shared anything yet."} They can turn on sharing from any book or shelf on their home page.
            </p>
          )}

          {!loading && !error && sharedBooks.length > 0 && (
            <section className="space-y-3 mt-4">
              <h3 className="text-base font-semibold">
                Shared books <span className="text-sm font-normal text-muted-foreground">({sharedBooks.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sharedBooks.map((book, i) => (
                  <SharedBookRow key={`shared-${i}`} book={book} adding={adding} added={added} onAdd={add} />
                ))}
              </div>
            </section>
          )}

          {!loading && !error && shelves.map((shelf) => (
            <section key={shelf.id} className="space-y-3 mt-4">
              <h3 className="text-base font-semibold">
                {shelf.name} <span className="text-sm font-normal text-muted-foreground">({shelf.books.length})</span>
              </h3>
              {shelf.books.length === 0 ? (
                <p className="text-sm text-muted-foreground">No books here yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {shelf.books.map((book, i) => (
                    <SharedBookRow key={`${shelf.id}-${i}`} book={book} adding={adding} added={added} onAdd={add} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </section>
      </main>
    </div>
  );
}