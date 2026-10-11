import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import BookCover from "@/components/tbr/BookCover";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BOOK_FORMATS, seriesLabel } from "@/lib/bookMeta";
import { buyLinksFor } from "@/lib/bookLinks";
import { ExternalLink, Trash2, Star, BookMarked, Loader2 } from "lucide-react";

const STATUS = { to_read: "To read", reading: "Reading", read: "Read" };

export default function BookDetailDialog({ open, onOpenChange, book, shelves, onChange }) {
  const [status, setStatus] = useState(book.status || "to_read");
  const [shelfId, setShelfId] = useState(book.shelf_id);
  const [notes, setNotes] = useState(book.notes || "");
  const [rating, setRating] = useState(book.rating || 0);
  const [format, setFormat] = useState(book.format || "");
  const [series, setSeries] = useState(null);
  const [checkingSeries, setCheckingSeries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const buyLinks = buyLinksFor(book);

  useEffect(() => {
    setStatus(book.status || "to_read");
    setShelfId(book.shelf_id);
    setNotes(book.notes || "");
    setRating(book.rating || 0);
    setFormat(book.format || "");
    setSeries(book.series_name ? { name: book.series_name, position: book.series_position || "" } : null);
  }, [book]);

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
        onChange();
      })
      .catch(() => {
        // A quiet miss: the book simply isn't in a series we can see.
      })
      .finally(() => {
        if (!cancelled) setCheckingSeries(false);
      });
    return () => { cancelled = true; };
  }, [open, book.id]);

  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.Book.update(book.id, {
        status, shelf_id: shelfId, notes, rating, ...(format ? { format } : {}),
      });
      setConfirmRemove(false);
      onOpenChange(false);
      onChange();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await base44.entities.Book.delete(book.id);
      setConfirmRemove(false);
      onOpenChange(false);
      onChange();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setConfirmRemove(false); onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <div className="flex gap-4">
          <BookCover
            book={book}
            className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border"
          />
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-tight">{book.title}</DialogTitle>
            <DialogDescription className="line-clamp-1">{book.author || "Unknown author"}</DialogDescription>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {series?.name && (
                <Badge className="font-normal gap-1">
                  <BookMarked className="w-3 h-3" />
                  {seriesLabel({ series_name: series.name, series_position: series.position })}
                </Badge>
              )}
              {checkingSeries && !series?.name && (
                <Badge variant="secondary" className="font-normal gap-1 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking series
                </Badge>
              )}
              {book.publisher && <Badge variant="secondary" className="font-normal">{book.publisher}</Badge>}
              {book.published_date && <Badge variant="secondary" className="font-normal">{book.published_date}</Badge>}
              {book.isbn && <Badge variant="secondary" className="font-normal">ISBN {book.isbn}</Badge>}
            </div>
            <div className="flex items-center gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)}>
                  <Star className={`w-4 h-4 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                </button>
              ))}
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
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> {l.name}
                </a>
              ))}
            </div>
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
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>

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
      </DialogContent>
    </Dialog>
  );
}