import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import BookCover from "@/components/tbr/BookCover";
import CoverPicker from "@/components/tbr/CoverPicker";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BOOK_FORMATS, formatsOf, rememberFormat } from "@/lib/bookMeta";
import BookTagsFields from "@/components/tbr/BookTagsFields";
import { isRomance, spiceOf, subgenreLabel } from "@/lib/spice";
import { warningsOf } from "@/lib/contentWarnings";
import { updateBook } from "@/lib/bookStore";
import { buyLinksFor, buyLinksDisclosure } from "@/lib/bookLinks";
import SharePanel from "@/components/tbr/SharePanel";
import { ExternalLink, Trash2, Star, ChevronLeft, Feather, Loader2, Share2, ImageIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { authorPath } from "@/lib/bookAuthors";
import OutboundLink from "@/components/tbr/OutboundLink";
import SeriesLine from "@/components/tbr/SeriesLine";
import BookDetailsFields from "@/components/tbr/BookDetailsFields";
import { AlertTriangle } from "lucide-react";

const STATUS = { to_read: "To read", reading: "Reading", read: "Read" };

// The book's own details, as the edit form holds them. A corrected value is written to the
// record and kept: later enrichment runs fill gaps, they never overwrite these.
const DETAIL_FIELDS = ["title", "author", "isbn", "asin", "description", "series_name", "series_position"];

const detailsFrom = (book) => ({
  title: book.title || "",
  author: book.author || "",
  isbn: book.isbn || "",
  asin: book.asin || "",
  description: book.description || "",
  series_name: book.series_name || "",
  series_position: book.series_position || "",
});

// Which details the reader has corrected by hand, which is what a later catalogue match must
// leave alone.
const editedFieldsWith = (book, details) => {
  const edited = new Set(Array.isArray(book.edited_fields) ? book.edited_fields : []);
  DETAIL_FIELDS.forEach((field) => {
    if (String(details[field] ?? "").trim() !== String(book[field] ?? "").trim()) edited.add(field);
  });
  return [...edited];
};

// The reader's own tags for this copy of the book: how spicy, which kind of romance, and
// what it should carry a warning for.
const tagsFrom = (book) => ({
  spice_rating: spiceOf(book),
  spice_shared: Boolean(book?.spice_shared),
  romance_subgenre: book?.romance_subgenre || "",
  content_warnings: warningsOf(book),
});

export default function BookDetailDialog({ open, onOpenChange, book, shelves, onSaved, onRemoved }) {
  const [status, setStatus] = useState(book.status || "to_read");
  const [shelfId, setShelfId] = useState(book.shelf_id);
  const [notes, setNotes] = useState(book.notes || "");
  const [review, setReview] = useState(book.review || "");
  const [rating, setRating] = useState(book.rating || 0);
  const [format, setFormat] = useState(book.format || "");
  const [extraFormats, setExtraFormats] = useState(() => formatsOf(book).filter((f) => f !== book.format));
  const [series, setSeries] = useState(null);
  const [checkingSeries, setCheckingSeries] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [tags, setTags] = useState(() => tagsFrom(book));
  const [details, setDetails] = useState(() => detailsFrom(book));
  const buyLinks = buyLinksFor(book);
  // The series the book is stored in, or the one just looked up for it.
  const currentSeries = series?.name
    ? series
    : book.series_name
      ? { name: book.series_name, position: book.series_position }
      : null;
  const navigate = useNavigate();

  useEffect(() => {
    setStatus(book.status || "to_read");
    setShelfId(book.shelf_id);
    setNotes(book.notes || "");
    setReview(book.review || "");
    setRating(book.rating || 0);
    setFormat(book.format || "");
    setExtraFormats(formatsOf(book).filter((f) => f !== book.format));
    setTags(tagsFrom(book));
    setDetails(detailsFrom(book));
    setError("");
    setConfirmRemove(false);
    // Opening the book re-reads what it holds now, so a value picked on an earlier visit and
    // never saved can't be submitted as though it belonged to the book.
  }, [book, open]);

  // Books saved before series tracking existed are filled in the first time
  // they are opened.
  useEffect(() => {
    if (!open || book.series_name || (!book.title && !book.isbn)) return;
    let cancelled = false;
    setCheckingSeries(true);
    base44.functions
      .invoke("bookSeries", { isbn: book.isbn || "", title: book.title, author: book.author || "" })
      .then(async (res) => {
        const found = res.data || {};
        if (cancelled || !found.series_name) return;
        setSeries({ name: found.series_name, position: found.series_position || "" });
        await base44.entities.Book.update(book.id, {
          series_name: found.series_name,
          series_position: found.series_position || "",
        });
        onSaved?.(book.id, { series_name: found.series_name, series_position: found.series_position || "" });
      })
      .catch(() => {
        // A quiet miss: the book simply isn't in a series we can see.
      })
      .finally(() => {
        if (!cancelled) setCheckingSeries(false);
      });
    return () => { cancelled = true; };
  }, [open, book.id]);

  // A save that fails says so, and the sheet stays open with everything the reader
  // chose still in place, rather than closing over a change that never landed.
  const write = async (changes) => {
    setError("");
    try {
      const { patch } = await updateBook(book, changes, shelves);
      await onSaved?.(book.id, patch);
      return true;
    } catch (e) {
      setError(e?.message || "That didn't save. Please try again.");
      return false;
    }
  };

  const save = async () => {
    if (saving) return;
    // A title is what a book is: without one there is nothing to save.
    if (!String(details.title || "").trim()) {
      setError("A book needs a title.");
      return;
    }
    setSaving(true);
    const cleaned = Object.fromEntries(
      DETAIL_FIELDS.map((field) => [field, String(details[field] ?? "").trim()])
    );
    const saved = await write({
      ...cleaned,
      status,
      shelf_id: shelfId,
      notes,
      review,
      rating,
      format,
      formats: [...new Set([format, ...extraFormats].filter(Boolean))],
      spice_rating: tags.spice_rating,
      spice_shared: tags.spice_shared,
      romance_subgenre: tags.romance_subgenre,
      content_warnings: tags.content_warnings,
      edited_fields: editedFieldsWith(book, cleaned),
    });
    if (saved) {
      rememberFormat(format);
      onOpenChange(false);
    }
    setSaving(false);
  };

  const remove = async () => {
    setRemoving(true);
    setError("");
    try {
      await base44.entities.Book.delete(book.id);
      setConfirmRemove(false);
      onOpenChange(false);
      await onRemoved?.();
    } catch {
      setError("That book couldn't be removed. Please try again.");
    } finally {
      setRemoving(false);
    }
  };

  const chooseCover = async (url) => {
    const saved = await write({ cover_url: url });
    if (saved) setPickingCover(false);
  };

  // The covers found for this book are kept on it, so a shelf can show a real one whenever
  // the saved cover is empty or fails to load.
  const saveAltCovers = (found = []) => {
    const known = Array.isArray(book.alt_covers) ? book.alt_covers : [];
    const fresh = found.filter((url) => url && url !== book.cover_url && !known.includes(url));
    if (!fresh.length) return;
    const next = [...known, ...fresh];
    base44.entities.Book
      .update(book.id, { alt_covers: next })
      .then(() => onSaved?.(book.id, { alt_covers: next }))
      .catch(() => {
        // A list of alternate covers is a convenience: the picker itself still works.
      });
  };

  const toggleExtraFormat = (value) => {
    setExtraFormats((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
  };

  const close = (next) => {
    if (!next) {
      setConfirmRemove(false);
      setSharing(false);
      setPickingCover(false);
      setError("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        {/* Sharing and the cover picker swap into this same dialog — a dialog stacked over
            this one hangs in the installed Android build. */}
        {sharing ? (
          <>
            <DialogHeader>
              <DialogTitle className="leading-tight">Share “{book.title}”</DialogTitle>
              <DialogDescription>Decide who can see this book from your reading circle.</DialogDescription>
            </DialogHeader>

            <SharePanel item={book} kind="book" onSaved={() => onSaved?.(book.id, {})} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setSharing(false)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back to book
              </Button>
            </DialogFooter>
          </>
        ) : pickingCover ? (
          <>
            <DialogHeader>
              <DialogTitle className="leading-tight">Choose a cover</DialogTitle>
              <DialogDescription>
                Every cover the catalogues hold for “{book.title}”, or one of your own.
              </DialogDescription>
            </DialogHeader>

            <CoverPicker
              book={book}
              chosen={book.cover_url}
              onPick={chooseCover}
              onCovers={saveAltCovers}
              busy={saving}
            />

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPickingCover(false)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back to book
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setPickingCover(true)}
                className="vp-coverbox w-24 shrink-0 self-start"
                aria-label="Change this book's cover"
              >
                <BookCover
                  book={book}
                  className="aspect-[2/3] w-full rounded-lg overflow-hidden bg-muted border border-border"
                />
                <span className="vp-coveredit"><ImageIcon /></span>
              </button>
              <div className="min-w-0 flex-1">
                <DialogTitle className="leading-tight">{book.title}</DialogTitle>
                <DialogDescription className="line-clamp-1">
                  {book.author ? (
                    <Link
                      to={authorPath(book.author)}
                      className="vp-author"
                      onClick={() => onOpenChange(false)}
                    >
                      {book.author}
                    </Link>
                  ) : (
                    "Unknown author"
                  )}
                </DialogDescription>
                <SeriesLine
                  name={currentSeries?.name}
                  position={currentSeries?.position}
                  className="mt-1"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {checkingSeries && !series?.name && (
                    <Badge variant="secondary" className="font-normal gap-1 text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking series
                    </Badge>
                  )}
                  {tags.romance_subgenre && (
                    <Badge variant="secondary" className="font-normal">{subgenreLabel(tags.romance_subgenre)}</Badge>
                  )}
                  {book.publisher && <Badge variant="secondary" className="font-normal">{book.publisher}</Badge>}
                  {book.published_date && <Badge variant="secondary" className="font-normal">{book.published_date}</Badge>}
                  {book.isbn && <Badge variant="secondary" className="font-normal">ISBN {book.isbn}</Badge>}
                  {book.enrichment_status === "failed" && (
                    <Badge variant="secondary" className="font-normal gap-1 text-amber-400">
                      <AlertTriangle className="w-3 h-3" /> No catalogue match
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} aria-label={`Rate ${n} out of 5`}>
                      <Star className={`w-4 h-4 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </button>
                  ))}
                </div>
                {Number(book.community_rating) > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Hardcover readers rate this {Number(book.community_rating).toFixed(1)} out of 5
                    {Number(book.community_ratings_count) > 0
                      ? ` (${Number(book.community_ratings_count).toLocaleString()} ratings)`
                      : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSharing(true)}>
                    <Share2 className="w-3.5 h-3.5" />
                    {book.share_enabled ? "Sharing on" : "Share this book"}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPickingCover(true)}>
                    <ImageIcon className="w-3.5 h-3.5" /> Change cover
                  </Button>
                  {book.author && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        onOpenChange(false);
                        navigate(authorPath(book.author));
                      }}
                    >
                      <Feather className="w-3.5 h-3.5" /> More by this author
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {book.description && (
              <p className="text-sm text-muted-foreground line-clamp-6 mt-2">{book.description}</p>
            )}

            {buyLinks.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">Where to buy</p>
                <div className="flex flex-wrap gap-3">
                  {buyLinks.map((l, i) => (
                    <OutboundLink key={i} href={l.url} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" /> {l.name}
                    </OutboundLink>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{buyLinksDisclosure}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Shelf</Label>
                <Select value={shelfId} onValueChange={setShelfId}>
                  <SelectTrigger className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Format</Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="h-11 sm:h-9"><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {BOOK_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground">Also in</span>
                  {BOOK_FORMATS.filter((f) => f.value !== format).map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => toggleExtraFormat(f.value)}
                      aria-pressed={extraFormats.includes(f.value)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                        extraFormats.includes(f.value)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <BookDetailsFields value={details} onChange={setDetails} idPrefix={`book-${book.id}`} />

            {book.enrichment_status === "failed" && (
              <p className="text-[11px] text-muted-foreground">
                No catalogue entry matched this book, so it holds only what you or your import gave
                it. Anything you correct above stays exactly as you wrote it.
              </p>
            )}

            <BookTagsFields
              value={tags}
              onChange={(patch) => setTags((prev) => ({ ...prev, ...patch }))}
              romance={isRomance(book)}
            />

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Your review</Label>
              <Textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                rows={3}
                placeholder="What you thought of it"
              />
              <p className="text-[11px] text-muted-foreground">
                Readers in your circle see this with your rating when you share the book. Your
                notes above stay yours alone.
              </p>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {confirmRemove && (
              <p className="text-sm text-muted-foreground">
                Remove “{book.title}” from your list? This can't be undone.
              </p>
            )}

            <DialogFooter className="justify-between sm:justify-between">
              {confirmRemove ? (
                <>
                  <Button variant="outline" onClick={() => setConfirmRemove(false)} disabled={removing}>Keep book</Button>
                  <Button variant="destructive" onClick={remove} disabled={removing}>
                    {removing ? "Removing..." : "Remove book"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}><Trash2 className="w-4 h-4 mr-1" /> Remove</Button>
                  <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}