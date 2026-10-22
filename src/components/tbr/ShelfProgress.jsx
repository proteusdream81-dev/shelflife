import React from "react";
import { BookCheck, BookOpen, Bookmark } from "lucide-react";

const statusOf = (book) => (book.status === "read" || book.status === "reading" ? book.status : "to_read");

// The shape of one shelf: what is finished against what is still waiting. It is counted from
// the whole shelf, so a search narrowing the grid never changes what the shelf has achieved.
export default function ShelfProgress({ books = [] }) {
  const total = books.length;
  if (!total) return null;

  const read = books.filter((book) => statusOf(book) === "read").length;
  const reading = books.filter((book) => statusOf(book) === "reading").length;
  const toRead = total - read - reading;
  const percent = Math.round((read / total) * 100);

  return (
    <div className="mt-3" aria-label={`${read} of ${total} books read`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          {read === total ? `All ${total} read` : `${read} of ${total} finished`}
        </p>
        <p className="text-[11px] font-semibold text-primary">{percent}%</p>
      </div>

      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={read}
        aria-valuetext={`${read} of ${total} read`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1">
          <BookCheck className="w-3.5 h-3.5 text-primary" strokeWidth={1.9} /> {read} read
        </li>
        <li className="flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.9} /> {reading} reading
        </li>
        <li className="flex items-center gap-1">
          <Bookmark className="w-3.5 h-3.5" strokeWidth={1.9} /> {toRead} pending
        </li>
      </ul>
    </div>
  );
}