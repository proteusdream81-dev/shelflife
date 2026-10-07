import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Trash2, Star } from "lucide-react";

const STATUS = { to_read: "To read", reading: "Reading", read: "Read" };

export default function BookDetailDialog({ open, onOpenChange, book, shelves, onChange }) {
  const [status, setStatus] = useState(book.status || "to_read");
  const [shelfId, setShelfId] = useState(book.shelf_id);
  const [notes, setNotes] = useState(book.notes || "");
  const [rating, setRating] = useState(book.rating || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(book.status || "to_read");
    setShelfId(book.shelf_id);
    setNotes(book.notes || "");
    setRating(book.rating || 0);
  }, [book]);

  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.Book.update(book.id, { status, shelf_id: shelfId, notes, rating });
      onOpenChange(false);
      onChange();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this book from your list?")) return;
    await base44.entities.Book.delete(book.id);
    onOpenChange(false);
    onChange();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <div className="flex gap-4">
          <div className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border">
            {book.cover_url && <Image src={book.cover_url} alt={book.title} fittingType="fill" className="w-full h-full" />}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-tight">{book.title}</DialogTitle>
            <DialogDescription className="line-clamp-1">{book.author || "Unknown author"}</DialogDescription>
            <div className="flex flex-wrap gap-1.5 mt-2">
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

        {book.buy_links && book.buy_links.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-medium text-muted-foreground mb-2">Where to buy</p>
            <div className="flex flex-wrap gap-3">
              {book.buy_links.map((l, i) => (
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
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Shelf</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 className="w-4 h-4 mr-1" /> Remove</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}