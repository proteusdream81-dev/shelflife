import React, { useEffect, useState } from "react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import BookCover from "@/components/tbr/BookCover";
import OutboundLink from "@/components/tbr/OutboundLink";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Check, ExternalLink, Feather, Loader2, Plus } from "lucide-react";
import { authorPath, displayAuthor } from "@/lib/bookAuthors";
import { buyLinksFor, buyLinksDisclosure } from "@/lib/bookLinks";
import { createBook, defaultShelfId } from "@/lib/bookStore";
import { rememberedFormat } from "@/lib/bookMeta";

// What a tap on a release opens: the cover, when it arrives, what the catalogues know about
// the book, and the two things a reader wants from it — a way to put it on their list, and a
// way to buy it.
export default function ReleaseDetailDialog({ release, open, onOpenChange, shelves = [], onAdded }) {
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !release) return undefined;
    let cancelled = false;
    setFacts(null);
    setAdded(false);
    setError("");
    setLoading(true);
    base44.functions
      .invoke("enrichBooks", {
        books: [{ key: release.id, title: release.title, author: release.author, isbn: release.isbn || "" }],
      })
      .then((res) => {
        const match = (res.data.results || [])[0];
        if (!cancelled && match?.matched) setFacts(match.book);
      })
      .catch(() => {
        // A book with no blurb to show is still worth opening: the date is the point.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, release?.id]);

  if (!release) return null;

  const when = moment(release.date);
  const upcoming = when.isSameOrAfter(moment(), "day");
  const cover = facts?.cover_url || release.cover_url;
  const author = displayAuthor(release.author);
  const dateLine = upcoming
    ? `Out in ${when.fromNow(true)}`
    : `Released ${when.fromNow(true)} ago`;
  // The same link-building module every other buy link comes from: the reader's own Amazon
  // storefront, tagged only where the app holds an Associates account.
  const buyLinks = buyLinksFor({
    title: release.title,
    author: release.author,
    isbn: release.isbn || "",
    buy_links: facts?.buy_links || [],
  });

  const addToTbr = async () => {
    if (adding || added) return;
    const shelfId = defaultShelfId(shelves);
    if (!shelfId) {
      setError("Add a shelf first, then this book has somewhere to land.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const format = rememberedFormat();
      await createBook({
        title: release.title,
        author: release.author,
        isbn: release.isbn || "",
        cover_url: cover || "",
        description: facts?.description || "",
        publisher: facts?.publisher || "",
        published_date: release.date,
        page_count: facts?.page_count || 0,
        categories: facts?.categories || [],
        buy_links: facts?.buy_links || [],
        google_books_id: facts?.google_books_id || "",
        series_name: facts?.series_name || "",
        series_position: facts?.series_position || "",
        shelf_id: shelfId,
        format,
        formats: [format],
      }, shelves);
      setAdded(true);
      onAdded?.();
    } catch (e) {
      setError(e?.message || "That didn't save. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <div className="flex gap-4">
          <div className="w-24 shrink-0 self-start overflow-hidden rounded-lg bg-secondary aspect-[2/3]">
            <BookCover book={{ title: release.title, cover_url: cover }} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-tight">{release.title}</DialogTitle>
            <DialogDescription className="line-clamp-1">{release.author}</DialogDescription>
            <p className="mt-2 text-sm text-primary">
              <CalendarDays className="mr-1 inline h-4 w-4 align-[-3px]" />
              {when.format("D MMMM YYYY")} · {dateLine}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {facts?.series_name && <Badge className="font-normal">{facts.series_name}</Badge>}
              {facts?.publisher && <Badge variant="secondary" className="font-normal">{facts.publisher}</Badge>}
              {facts?.page_count ? (
                <Badge variant="secondary" className="font-normal">{facts.page_count} pages</Badge>
              ) : null}
              {release.isbn && <Badge variant="secondary" className="font-normal">ISBN {release.isbn}</Badge>}
            </div>
          </div>
        </div>

        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Looking this book up...
          </p>
        )}
        {!loading && facts?.description && (
          <p className="text-sm text-muted-foreground line-clamp-6">{facts.description}</p>
        )}
        {!loading && !facts?.description && (
          <p className="text-sm text-muted-foreground">
            No description for this one yet, which usually means it isn't published.
          </p>
        )}

        {buyLinks.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Where to buy</p>
            <div className="flex flex-wrap gap-3">
              {buyLinks.map((link, i) => (
                <OutboundLink
                  key={i}
                  href={link.url}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {link.name}
                </OutboundLink>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{buyLinksDisclosure}</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-1.5" onClick={addToTbr} disabled={adding || added}>
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : added ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {added ? "On your TBR" : "Add to TBR"}
            </Button>
            {author && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  onOpenChange(false);
                  navigate(authorPath(author));
                }}
              >
                <Feather className="h-4 w-4" /> More by {author}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}