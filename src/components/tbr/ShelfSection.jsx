import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, Share2, Pencil, Trash2, MoreVertical } from "lucide-react";
import BookCard from "@/components/tbr/BookCard";
import ShareDialog from "@/components/tbr/ShareDialog";
import ShelfForm from "@/components/tbr/ShelfForm";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ShelfSection({ shelf, books, allShelves, onChange, isPrivate }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete shelf "${shelf.name}" and all its books?`)) return;
    await base44.entities.Book.deleteMany({ shelf_id: shelf.id });
    await base44.entities.Shelf.delete(shelf.id);
    onChange();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{shelf.name}</h2>
          {isPrivate && <Lock className="w-4 h-4 text-muted-foreground" />}
          <Badge variant="secondary" className="font-normal">{books.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
            <Share2 className="w-4 h-4 mr-1" /> Share
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-2" /> Edit shelf</DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" /> Delete shelf</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">No books here yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} shelves={allShelves} onChange={onChange} />
          ))}
        </div>
      )}

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} shelf={shelf} onSaved={onChange} />
      <ShelfForm open={editOpen} onOpenChange={setEditOpen} shelf={shelf} onSaved={onChange} />
    </section>
  );
}