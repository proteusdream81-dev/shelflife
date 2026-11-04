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
import { authorSearchUrl, buyLinksDisclosure } from "@/lib/bookLinks";
import PullToRefresh from "@/components/PullToRefresh";

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
      setOthers(booksFromSearch(res.data));
      setPartial(res.data.partial === true);
      setOtherStatus("ready");
    } catch {
      setOtherStatus("error");
    }
  };

  const refresh = async () => {
    await Promise.all([load(), loadCatalogue()]);
  };

  useEffect(() => {
    if (!author) return;
    load();
    loadCatalogue();
  }, [author]);

  const owned = useMemo(() => ownedIndex(books), [books]);

  const add = async (book) => {
    if (busyKey) return;
    if (isOwned(book, owned, rememberedFormat())) {
      setError("That book is already on your shelves.");
      return;
    }
    setMessage("");
    setError("");
    setBusyKey(catalogueKey(book));
    try {
      const shelfId = defaultShelfId(shelves);
      if (!shelfId) {
        setError("Add a shelf first, then you can place books on it.");
        return;
      }
      const created = await createBook(
        {
          ...recordFromCatalogue(book),
          shelf_id: shelfId,
          status: "to_read",
          format: rememberedFormat() || book.format || "",
        },
        shelves
      );
      setBooks((prev) => [created, ...prev]);
      setOthers((prev) => prev.filter((row) => catalogueKey(row) !== catalogueKey(book)));
      setMessage(`Added to ${shelfNameFor(shelves, shelfId) || "your shelves"}.`);
    } catch {
      setError("Could not add that book just now. Try again.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="vp-page">
      <PullToRefresh onRefresh={refresh} />
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="vp-btn vp-icon"
              aria-label="Go back"
            >
              <ArrowLeft strokeWidth={1.8} />
            </button>
            <div className="vp-brand">
              <div className="vp-mark"><Feather strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong className="line-clamp-1">{shown || "Author"}</strong>
                <span>On your shelves and beyond</span>
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
              Could not load this author just now.
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
                    <BookCard key={book.id} book={book} shelves={shelves} />
                  ))}
                </div>
              )}
            </section>

            <section className="vp-shelf">
              <div className="vp-shelfhead">
                <div className="vp-titleline">
                  <h2>More by {shown || "this author"}</h2>
                </div>
              </div>
              {otherStatus === "loading" && (
                <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching the catalogue...
                </div>
              )}
              {otherStatus === "error" && (
                <p className="vp-empty">
                  Catalogue search failed.
                  <Button size="sm" variant="outline" className="mt-3" onClick={loadCatalogue}>Try again</Button>
                </p>
              )}
              {otherStatus === "ready" && others.length === 0 && (
                <p className="vp-empty">No further titles found for {shown || "this author"}.</p>
              )}
              {otherStatus === "ready" && others.length > 0 && (
                <div className="flex flex-col gap-2">
                  {others.map((book) => (
                    <AuthorBookRow
                      key={catalogueKey(book)}
                      book={book}
                      busy={busyKey === catalogueKey(book)}
                      owned={isOwned(book, owned, rememberedFormat())}
                      onAdd={() => add(book)}
                    />
                  ))}
                  {partial && (
                    <p className="text-xs text-muted-foreground px-1">Showing a partial catalogue result.</p>
                  )}
                </div>
              )}
              {message && <p className="text-sm text-primary mt-3">{message}</p>}
              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
              <p className="text-xs text-muted-foreground mt-4">
                <OutboundLink href={authorSearchUrl(shown)} className="underline underline-offset-2">
                  Search wider online <ExternalLink className="inline w-3 h-3" />
                </OutboundLink>
                {" "}· {buyLinksDisclosure()}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
