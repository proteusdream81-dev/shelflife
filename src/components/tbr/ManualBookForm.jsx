import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Loader2 } from "lucide-react";
import { BOOK_FORMATS, rememberedFormat, rememberFormat } from "@/lib/bookMeta";
import { createBook, defaultShelfId } from "@/lib/bookStore";
import { ownedIndex, isOwned } from "@/lib/ownedBooks";

export default function ManualBookForm({ shelves, onSaved, books = [] }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [publisher, setPublisher] = useState("");
  const [notes, setNotes] = useState("");
  const [shelfId, setShelfId] = useState(() => defaultShelfId(shelves));
  const [format, setFormat] = useState(rememberedFormat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const owned = useMemo(() => ownedIndex(books), [books]);

  // Live match against the reader's library so a duplicate is visible before they hit Add.
  const alreadyHeld = useMemo(() => {
    const t = title.trim();
    if (!t && !isbn.trim()) return false;
    return isOwned({ title: t, author, isbn, format }, owned, format);
  }, [title, author, isbn, format, owned]);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving || alreadyHeld) return;
    setSaving(true);
    setError("");

    const candidate = { title: title.trim(), author, isbn, format };
    // Same recognition rules as search and scan: ISBN, then title + author, scoped by edition.
    if (isOwned(candidate, owned, format)) {
      setError("That book is already on your shelves. Nothing was added.");
      setSaving(false);
      return;
    }

    try {
      await createBook({
        title: title.trim(), author, isbn, cover_url: coverUrl, publisher, notes,
        shelf_id: shelfId, format, formats: [format],
      }, shelves);
      rememberFormat(format);
      onSaved();
    } catch (err) {
      setError(err?.message || "We couldn't save this book. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Title *</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Author</Label>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">ISBN</Label>
          <Input value={isbn} onChange={(e) => setIsbn(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Publisher</Label>
          <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cover URL</Label>
          <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Shelf *</Label>
          <Select value={shelfId} onValueChange={setShelfId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {shelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOOK_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      {alreadyHeld && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-primary">
          <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
          Already on your shelves for this format.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={saving || !title.trim() || alreadyHeld}>
        {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        {alreadyHeld ? "Already on your list" : "Add book"}
      </Button>
    </form>
  );
}
