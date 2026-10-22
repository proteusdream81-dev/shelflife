import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import BookCover from "@/components/tbr/BookCover";
import HiddenCover from "@/components/tbr/HiddenCover";
import ShareJoinCard from "@/components/tbr/ShareJoinCard";
import CommentsPanel from "@/components/tbr/CommentsPanel";
import GetShelfLifeCta from "@/components/tbr/GetShelfLifeCta";
import { Badge } from "@/components/ui/badge";
import { formatLabel, seriesLabel } from "@/lib/bookMeta";
import { buyLinksFor, buyLinksDisclosure } from "@/lib/bookLinks";
import OutboundLink from "@/components/tbr/OutboundLink";
import { applyShareMeta } from "@/lib/pageMeta";
import { HERO_IMAGE } from "@/lib/brand";
import { BookOpen, ExternalLink, Loader2 } from "lucide-react";

const STATUS = { to_read: "To read", reading: "Reading", read: "Read" };

export default function Share() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    (async () => {
      // The link opens for anyone: the token is the key, so nobody is stopped by a
      // login screen before they can see the list a friend sent them.
      setSignedIn(await base44.auth.isAuthenticated().catch(() => false));
      try {
        const res = await base44.functions.invoke("getSharedShelf", { token });
        setData(res.data);
      } catch (e) {
        setError(e.message || "Not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // The preview this link shows when it is posted: the app's own title would say
  // nothing about the list, so the reader and their book count go in instead.
  useEffect(() => {
    if (!data) return;
    const reader = data.reader_name || "A reader";

    if (data.kind === "book") {
      const b = data.book || {};
      applyShareMeta({
        title: `${reader} shared "${b.title}"`,
        description: `${b.author ? `By ${b.author}. ` : ""}From ${reader}'s reading list on ShelfLife.`,
        image: HERO_IMAGE,
      });
      return;
    }

    const count = Array.isArray(data.books) ? data.books.length : 0;
    const bookWord = count === 1 ? "book" : "books";
    const shelfName = data.shelf?.name || "a reading list";
    const note = data.shelf?.description;
    // A cover says far more in a chat preview than the app's own artwork, so the first one on the
    // shelf stands in for it, with the hero as the fallback for an empty list.
    const cover = (data.books || []).map((b) => b.cover_url).find(Boolean);
    applyShareMeta({
      title: `${reader} shared "${shelfName}": ${count} ${bookWord}`,
      description: `${reader} shared ${count} ${bookWord} on ShelfLife${note ? `. ${note}` : "."}`,
      image: cover || HERO_IMAGE,
    });
  }, [data]);

  if (loading) {
    return (
      <div className="vp-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="vp-page flex flex-col items-center justify-center text-center px-4">
        <BookOpen className="w-10 h-10 text-muted-foreground mb-3" strokeWidth={1.8} />
        <p className="text-muted-foreground">This shared list isn't available.</p>
      </div>
    );
  }

  // A link can point at one book as well as a whole shelf.
  if (data.kind === "book") {
    const b = data.book;
    const links = buyLinksFor(b);

    return (
      <div className="vp-page">
        <header className="vp-top">
          <div className="vp-topin max-w-3xl mx-auto">
            <div className="vp-bar">
              <div className="vp-brand">
                <div className="vp-mark">
                  <BookOpen strokeWidth={1.8} />
                </div>
                <div className="vp-brandtxt">
                  <strong>TBR</strong>
                  <span>Shared book</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6">
          <section className="vp-shelf">
            <div className="flex gap-4">
              {data.covers_hidden ? (
                <HiddenCover className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden border border-border" />
              ) : (
                <BookCover
                  book={b}
                  className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl text-foreground leading-tight">{b.title}</h1>
                <p className="text-sm text-muted-foreground mt-1">{b.author || "Unknown author"}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {seriesLabel(b) && <Badge className="font-normal">{seriesLabel(b)}</Badge>}
                  {b.format && <Badge variant="secondary" className="font-normal">{formatLabel(b.format)}</Badge>}
                  <Badge variant="secondary" className="font-normal">{STATUS[b.status] || "To read"}</Badge>
                  {b.publisher && <Badge variant="secondary" className="font-normal">{b.publisher}</Badge>}
                  {b.published_date && <Badge variant="secondary" className="font-normal">{b.published_date}</Badge>}
                </div>
              </div>
            </div>

            {b.description && (
              <p className="text-sm text-muted-foreground mt-4">{b.description}</p>
            )}

            {links.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Where to buy</p>
                <div className="flex flex-wrap gap-3">
                  {links.map((l, i) => (
                    <OutboundLink key={i} href={l.url} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" /> {l.name}
                    </OutboundLink>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{buyLinksDisclosure}</p>
              </div>
            )}
          </section>

          <CommentsPanel token={token} className="mt-6" />

          {!signedIn && <ShareJoinCard token={token} className="mt-6" />}
        </main>
      </div>
    );
  }

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <BookOpen strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>TBR</strong>
                <span>Shared reading list</span>
              </div>
            </div>
          </div>
          <div className="vp-rule pb-3">
            <h1 className="text-3xl text-foreground">{data.shelf.name}</h1>
            <p className="text-xs text-muted-foreground mt-2">
              {data.books.length} {data.books.length === 1 ? "book" : "books"}
              {data.reader_name ? ` · Shared by ${data.reader_name}` : ""}
            </p>
            {data.shelf.description && (
              <p className="text-sm text-muted-foreground mt-2">{data.shelf.description}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {data.books.length === 0 ? (
          <p className="vp-empty">No books in this list.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.books.map((b, i) => (
              <div key={i}>
                {data.covers_hidden ? <HiddenCover /> : <BookCover book={b} />}
                {/* The text under a cover keeps the same two lines as every other tile, so a
                    short title can't leave its row looking ragged. */}
                <h3 className="mt-2 min-h-[2.5em] text-sm leading-tight line-clamp-2 text-foreground">{b.title}</h3>
                <p className="min-h-[1.25em] text-xs text-muted-foreground line-clamp-1">{b.author || "Unknown"}</p>
              </div>
            ))}
          </div>
        )}
        <CommentsPanel token={token} className="mt-8" />
        <GetShelfLifeCta className="mt-8" />
      </main>

      {!signedIn && (
        <div className="max-w-5xl mx-auto px-4">
          <ShareJoinCard token={token} className="mb-10" />
        </div>
      )}
    </div>
  );
}