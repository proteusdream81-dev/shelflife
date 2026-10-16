import React, { useState } from "react";
import { Link } from "react-router-dom";
import BookCover from "@/components/tbr/BookCover";
import BookDetailDialog from "@/components/tbr/BookDetailDialog";
import { Check, BookOpen } from "lucide-react";
import { formatLabel, seriesLabel } from "@/lib/bookMeta";
import { authorPath } from "@/lib/bookAuthors";

// One book on a shelf. The cover and the title are the tap target that opens the book, while
// the author name under them is its own link. The text is capped to the same number of lines
// for every card, so a long title can't push its row out of line with the covers beside it.
export default function BookCard({ book, shelves, onSaved, onRemoved }) {
  const [open, setOpen] = useState(false);
  const meta = [seriesLabel(book), formatLabel(book.format)].filter(Boolean).join(" · ");
  const finished = book.status === "read";
  const started = book.status === "reading";
  const author = String(book.author || "").trim();

  return (
    <>
      <div className="vp-book">
        <button type="button" className="vp-booktap" onClick={() => setOpen(true)}>
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
        </button>
        {/* The author name is a link of its own, so a tap there opens the author rather than
            the book. */}
        <p>{author ? <Link to={authorPath(author)} className="vp-author">{author}</Link> : "Unknown"}</p>
        <p className="vp-bookmeta">{meta || "\u00A0"}</p>
      </div>
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