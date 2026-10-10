import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image } from "@/components/ui/image";
import { ArrowLeft, Check, Loader2, Plus, Users } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";

export default function ReaderLibrary() {
  const { readerId } = useParams();
  const location = useLocation();
  const [name, setName] = useState(location.state?.name || "");
  const [shelves, setShelves] = useState([]);
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
        setShelfId(mine[0]?.id || "");
        setShelves(res.data.shelves || []);
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
      await base44.entities.Book.create({
        title: book.title, author: book.author, isbn: book.isbn, cover_url: book.cover_url,
        description: book.description, publisher: book.publisher, published_date: book.published_date,
        page_count: book.page_count, categories: book.categories, buy_links: book.buy_links,
        google_books_id: book.google_books_id, shelf_id: shelfId, status: "to_read",
      });
      setAdded((a) => ({ ...a, [key]: true }));
    } finally {
      setAdding("");
    }
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
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

          {!loading && !error && shelves.length === 0 && (
            <p className="vp-empty">
              {name ? `${name} hasn't shared any shelves yet.` : "This reader hasn't shared any shelves yet."} They can turn on sharing from any shelf on their home page.
            </p>
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
                  {shelf.books.map((book, i) => {
                    const key = `${book.isbn}|${book.title}`;
                    return (
                      <div key={`${shelf.id}-${i}`} className="flex gap-2 p-2 rounded-lg border border-border">
                        <div className="w-9 shrink-0 aspect-[2/3] rounded bg-muted overflow-hidden">
                          {book.cover_url && <Image src={book.cover_url} alt="" fittingType="fill" className="w-full h-full" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium line-clamp-2 leading-tight">{book.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => add(book)}
                          disabled={adding === key || added[key]}
                          title="Add to my list"
                        >
                          {adding === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : added[key] ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Plus className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </section>
      </main>
    </div>
  );
}