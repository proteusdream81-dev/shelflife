import React, { useEffect, useState } from "react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import BookCover from "@/components/tbr/BookCover";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Feather, Loader2 } from "lucide-react";
import { authorPath, firstAuthor } from "@/lib/bookAuthors";

// What a tap on a release opens: the cover, when it arrives, and what the catalogues know
// about the book.
export default function ReleaseDetailDialog({ release, open, onOpenChange }) {
  const [facts, setFacts] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !release) return undefined;
    let cancelled = false;
    setFacts(null);
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
  const author = firstAuthor(release.author);
  const dateLine = upcoming
    ? `Out in ${when.fromNow(true)}`
    : `Released ${when.fromNow(true)} ago`;

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

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {author && (
            <Button
              className="gap-1.5"
              onClick={() => {
                onOpenChange(false);
                navigate(authorPath(author));
              }}
            >
              <Feather className="h-4 w-4" /> More by {author}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}