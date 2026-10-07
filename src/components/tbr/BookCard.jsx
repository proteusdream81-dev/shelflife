import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import BookDetailDialog from "@/components/tbr/BookDetailDialog";

export default function BookCard({ book, shelves, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="group text-left">
        <div className="aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border shadow-sm transition-shadow group-hover:shadow-md">
          {book.cover_url ? (
            <Image src={book.cover_url} alt={book.title} fittingType="fill" className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-2 text-center">
              <span className="text-xs font-medium text-muted-foreground line-clamp-3">{book.title}</span>
            </div>
          )}
        </div>
        <h3 className="mt-2 text-sm font-medium line-clamp-2 leading-tight">{book.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author || "Unknown"}</p>
      </button>
      <BookDetailDialog open={open} onOpenChange={setOpen} book={book} shelves={shelves} onChange={onChange} />
    </>
  );
}