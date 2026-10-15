import React, { useState } from "react";
import BookCover from "@/components/tbr/BookCover";
import BookDetailDialog from "@/components/tbr/BookDetailDialog";
import { Check, BookOpen } from "lucide-react";
import { formatLabel, seriesLabel } from "@/lib/bookMeta";

// One book on a shelf. The text under the cover is capped to the same number of lines for
// every card, so a long title can't push its row out of line with the covers beside it.
export default function BookCard({ book, shelves, onSaved, onRemoved }) {
  const [open, setOpen] = useState(false);
  const meta = [seriesLabel(book), formatLabel(book.format)].filter(Boolean).join(" · ");
  const finished = book.status === "read";
  const started = book.status === "reading";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="vp-book">
        <span className="vp-coverbox">
          <BookCover book={book} />
          {(finished || started) && (
            <span
              className={`vp-readbadge ${finished ? "vp-readbadge-done" : "vp-readbadge-reading"}`}
              title={finished ? "Read" : "Reading"}
              aria-label={finished ? "Read" : "Reading"}
            >
              {finished ? <Check strokeWidth={3.5} /> : <BookOpen strokeWidth={2.5} />}
            </span>
          )}
        </span>
        <h3>{book.title}</h3>
        <p>{book.author || "Unknown"}</p>
        <p className="vp-bookmeta">{meta || "\u00A0"}</p>
      </button>
      <BookDetailDialog
        open={open}
        onOpenChange={setOpen}
        book={book}
        shelves={shelves}
        onSaved={onSaved}
        onRemoved={onRemoved}
      />
    </>
  );
}