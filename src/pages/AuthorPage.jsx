import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import AppNav from "@/components/tbr/AppNav";
import BookCard from "@/components/tbr/BookCard";
import AuthorBookRow from "@/components/tbr/AuthorBookRow";
import { Button } from "@/components/ui/button";
import { createBook, defaultShelfId, shelfNameFor } from "@/lib/bookStore";
import { rememberedFormat } from "@/lib/bookMeta";
import { catalogueKey, recordFromCatalogue } from "@/lib/catalogue";
import {
  authorFromParam, authorMatches, authorPattern, authorSearchTerm, displayAuthor,
} from "@/lib/bookAuthors";
import { booksFromSearch } from "@/lib/searchResult";
import { isOwned, ownedIndex } from "@/lib/ownedBooks";
import { ArrowLeft, ExternalLink, Feather, Loader2 } from "lucide-react";
import OutboundLink from "@/components/tbr/OutboundLink";
import { authorSearchUrl } from "@/lib/bookLinks";

// Everything one author has: what the reader already holds, and what else exists to add.
export default function AuthorPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const author = authorFromParam(name);
  const shown = displayAuthor(author);

  const [shelves, setShelves] = useState([]);
  const [books, setBooks] = useState([]);
  const [others, setOthers] = useState([]);
  const [status, setStatus] = useState("loading");
  const [otherStatus, setOtherStatus] = useState("loading");
  const [partial, setPartial] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // The server searches on one word of the name, then every book that comes back is checked
  // against the whole name, so "King" can't pull in "Kingsolver".
  const load = async () => {
    setStatus("loading");
    try {
      const [shelfList, found] = await Promise.all([
        base44.entities.Shelf.list("-created_date", 100),
        base44.entities.Book.filter(
          { author: { $regex: authorPattern(authorSearchTerm(shown)), $options: "i" } },
          { sort: "-created_date", limit: 100 }
        ),
      ]);
      setShelves(shelfList);
      setBooks(found.items.filter((book) => authorMatches(book.author, author)));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  const loadCatalogue = async () => {
    setOtherStatus("loading");
    setPartial(false);
    try {
      const res = await base44.functions.invoke("searchBooks", { query: shown, type: "author" });
      // A reply with no book list is a failure, so it lands on the error state below rather
      // than reading as "no other books by this author".
      setOthers(booksFromSearch(res.data));
      setPartial(res.data.partial === true);
      setOtherStatus("ready");
    } catch {
      setOtherStatus("error");
    }
  };

  useEffect(() => {
    if (!author) return;
    load();
    loadCatalogue();
  }, [author]);

  const owned = useMemo(() => ownedIndex(books), [books]);

  const add = async (book) => {
    if (busyKey) return;
    setMessage("");
    setError("");
    setBusyKey(catalogueKey(book));
    try {
      const shelfId = defaultShelfId(shelves);
      const created = await createBook(recordFromCatalogue(book, shelfId, rememberedFormat()), shelves);
      setBooks((prev) => [created, ...prev]);
      setMessage(`Added \u201C${book.title}\u201D to ${shelfNameFor(shelves, shelfId) || "your shelf"}.`);
    } catch (e) {
      setError(e?.message || "That book couldn't be added. Please try again.");
    } finally {
      setBusyKey("");
    }
  };

  const applyChange = (id, patch) =>
    setBooks((prev) => prev.map((book) => (book.id === id ? { ...book, ...patch } : book)));

  const removeBook = (id) => setBooks((prev) => prev.filter((book) => book.id !== id));

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="vp-btn vp-icon"
              aria-label="Go back">
              <ArrowLeft strokeWidth={1.8} />
            </button>
            <div className="vp-brand">
              <div className="vp-mark"><Feather strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong className="line-clamp-1">{shown || "Author"}</strong>
                <span>Everything by this author</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        {status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Looking through your shelves...
          </div>
        )}

        {status === "error" && (
          <section className="vp-shelf">
            <p className="vp-empty">
              We couldn't load your books right now.
              <Button size="sm" variant="outline" className="mt-3" onClick={load}>Try again</Button>
            </p>
          </section>
        )}

        {status === "ready" && (
          <>
            <section className="vp-shelf">
              <div className="vp-shelfhead">
                <div className="vp-titleline">
                  <h2>On your shelves</h2>
                  {books.length > 0 && <span className="vp-badge">{books.length}</span>}
                </div>
              </div>

              {books.length === 0 ? (
                <p className="vp-empty">Nothing by {shown || "this author"} on your shelves yet.</p>
              ) : (
                <div className="vp-covergrid">
                  {books.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      shelves={shelves}
                      onSaved={applyChange}
                      onRemoved={removeBook}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="vp-shelf">
              <div className="vp-shelfhead">
                <div className="vp-titleline">
                  <h2>Also by {shown || "this author"}</h2>
                  {others.length > 0 && <span className="vp-badge">{others.length}</span>}
                </div>
                <div className="vp-shelfops">
                  <OutboundLink href={authorSearchUrl(shown)} className="vp-btn vp-small">
                    <ExternalLink strokeWidth={1.8} /> Amazon
                  </OutboundLink>
                </div>
              </div>

              {message && <p role="status" className="mb-2 text-sm text-primary">{message}</p>}
              {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}

              {otherStatus === "loading" && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking the book catalogues...
                </div>
              )}

              {otherStatus === "error" && (
                <p className="vp-empty">
                  We couldn't reach the book catalogues right now.
                  <Button size="sm" variant="outline" className="mt-3" onClick={loadCatalogue}>Try again</Button>
                </p>
              )}

              {otherStatus === "ready" && (
                others.length === 0 ? (
                  <p className="vp-empty">No other books by this author in the catalogues.</p>
                ) : (
                  <div className="space-y-2">
                    {others.map((book) => (
                      <AuthorBookRow
                        key={catalogueKey(book)}
                        book={book}
                        owned={isOwned(book, owned)}
                        busy={busyKey === catalogueKey(book)}
                        disabled={!!busyKey}
                        onAdd={add}
                      />
                    ))}
                  </div>
                )
              )}

              {partial && otherStatus === "ready" && (
                <p role="status" className="mt-3 text-xs text-amber-400">
                  One of the book catalogues didn't answer, so this list may be shorter than usual.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}