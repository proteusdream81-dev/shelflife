import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import BookDetailDialog from "@/components/tbr/BookDetailDialog";
import { seriesLabel } from "@/lib/bookMeta";

export default function BookCard({ book, shelves, onChange }) {
  const [open, setOpen] = useState(false);
  const meta = [seriesLabel(book), book.format === "kindle" ? "Kindle" : ""].filter(Boolean).join(" · ");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="vp-book">
        <div className={book.cover_url ? "vp-cover" : "vp-cover vp-art"}>
          {book.cover_url ? (
            <Image src={book.cover_url} alt={book.title} fittingType="fill" className="w-full h-full" />
          ) : (
            <span>{book.title}</span>
          )}
        </div>
        <h3>{book.title}</h3>
        <p>{book.author || "Unknown"}</p>
        {meta && <p className="vp-bookmeta">{meta}</p>}
      </button>
      <BookDetailDialog open={open} onOpenChange={setOpen} book={book} shelves={shelves} onChange={onChange} />
    </>
  );
}