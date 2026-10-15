import React from "react";
import { Check, Loader2, AlertTriangle, Layers } from "lucide-react";

// What happened to each book the import read, so a title that could not be matched is
// visible rather than silently sitting on the shelf as a bare line of text.
const MARKS = {
  waiting: { Icon: Loader2, className: "text-muted-foreground animate-spin", label: "Waiting" },
  matched: { Icon: Check, className: "text-primary", label: "Metadata found" },
  merged: { Icon: Layers, className: "text-primary", label: "Already in your list — details filled in" },
  duplicate: { Icon: Layers, className: "text-muted-foreground", label: "Already in your list" },
  unmatched: { Icon: AlertTriangle, className: "text-amber-400", label: "No metadata found" },
  error: { Icon: AlertTriangle, className: "text-destructive", label: "Couldn't be checked" },
};

const countsOf = (books, statuses) =>
  books.reduce((tally, book) => {
    const seen = statuses[book.key] || "waiting";
    tally[seen] = (tally[seen] || 0) + 1;
    return tally;
  }, {});

export default function ImportStatusList({ books, statuses }) {
  const counts = countsOf(books, statuses);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).map(([status, count]) => (
          <span key={status} className="text-xs text-muted-foreground">
            {count} {MARKS[status]?.label || status}
          </span>
        ))}
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {books.map((book) => {
          const mark = MARKS[statuses[book.key] || "waiting"] || MARKS.waiting;
          const { Icon } = mark;
          return (
            <div key={book.key} className="flex items-center gap-2 px-3 py-2">
              <Icon className={`w-4 h-4 shrink-0 ${mark.className}`} />
              <span className="min-w-0 flex-1 truncate text-sm">{book.title}</span>
              {book.author && (
                <span className="hidden sm:block max-w-[40%] truncate text-xs text-muted-foreground">{book.author}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}