import React, { useState } from "react";
import BookCover from "@/components/tbr/BookCover";
import BookDetailDialog from "@/components/tbr/BookDetailDialog";
import { seriesLabel } from "@/lib/bookMeta";

export default function BookCard({ book, shelves, onChange }) {
  const [open, setOpen] = useState(false);
  const meta = [seriesLabel(book), book.format === "kindle" ? "Kindle" : ""].filter(Boolean).join(" · ");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="vp-book">
        <BookCover book={book} />
        <h3>{book.title}</h3>
        <p>{book.author || "Unknown"}</p>
        {meta && <p className="vp-bookmeta">{meta}</p>}
      </button>
      <BookDetailDialog open={open} onOpenChange={setOpen} book={book} shelves={shelves} onChange={onChange} />
    </>
  );
}