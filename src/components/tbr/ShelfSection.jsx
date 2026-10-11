import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Lock, Share2, Pencil, Trash2, MoreVertical } from "lucide-react";
import BookCard from "@/components/tbr/BookCard";
import ConfirmDialog from "@/components/tbr/ConfirmDialog";
import ShareDialog from "@/components/tbr/ShareDialog";
import ShelfForm from "@/components/tbr/ShelfForm";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ShelfSection({ shelf, books, allShelves, onChange, isPrivate }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    await base44.entities.Book.deleteMany({ shelf_id: shelf.id });
    await base44.entities.Shelf.delete(shelf.id);
    setConfirmDelete(false);
    onChange();
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>{shelf.name}</h2>
          {isPrivate && <Lock className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />}
          <span className="vp-badge">{books.length}</span>
        </div>
        <div className="vp-shelfops">
          <button type="button" className="vp-btn vp-small" onClick={() => setShareOpen(true)}>
            <Share2 strokeWidth={1.8} /> Share
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="vp-btn vp-icon vp-small" aria-label="Shelf menu">
                <MoreVertical strokeWidth={1.8} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-2" /> Edit shelf</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" /> Delete shelf</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {books.length === 0 ? (
        <p className="vp-empty">No books here yet.</p>
      ) : (
        <div className="vp-covergrid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} shelves={allShelves} onChange={onChange} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${shelf.name}”?`}
        description={`The shelf and the ${books.length} ${books.length === 1 ? "book" : "books"} on it will be removed. This can't be undone.`}
        confirmLabel="Delete shelf"
        onConfirm={handleDelete}
      />

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} shelf={shelf} onSaved={onChange} />
      <ShelfForm open={editOpen} onOpenChange={setEditOpen} shelf={shelf} onSaved={onChange} />
    </section>
  );
}