import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image } from "@/components/ui/image";
import { Loader2, Plus, Check } from "lucide-react";

export default function ReaderLibraryDialog({ open, onOpenChange, reader, myShelves }) {
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shelfId, setShelfId] = useState(myShelves?.[0]?.id || "");
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState({});

  useEffect(() => {
    if (!open || !reader) return;
    setLoading(true);
    setShelves([]);
    setAdded({});
    setShelfId(myShelves?.[0]?.id || "");
    base44.functions
      .invoke("readingCircle", { action: "library", user_id: reader.id })
      .then((res) => setShelves(res.data.shelves || []))
      .finally(() => setLoading(false));
  }, [open, reader]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reader?.name}'s shelves</DialogTitle>
          <DialogDescription>The shelves {reader?.name} has shared with their reading circle.</DialogDescription>
        </DialogHeader>

        {myShelves?.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Add to my</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {myShelves.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

        {!loading && shelves.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {reader?.name} hasn't shared any shelves yet. They can turn on sharing from any shelf on their home page.
          </p>
        )}

        {!loading && shelves.map((shelf) => (
          <section key={shelf.id} className="space-y-3">
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
      </DialogContent>
    </Dialog>
  );
}