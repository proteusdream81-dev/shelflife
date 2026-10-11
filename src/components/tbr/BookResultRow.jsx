import React from "react";
import BookCover from "@/components/tbr/BookCover";
import { Badge } from "@/components/ui/badge";
import { formatLabel } from "@/lib/bookMeta";
import { Check, Loader2, Plus } from "lucide-react";

export default function BookResultRow({ book, selected, onToggle, disabled, busy, owned, formats }) {
  const locked = disabled || busy || owned;
  const marked = disabled || owned;

  return (
    <button
      type="button"
      onClick={() => !locked && onToggle(book)}
      disabled={locked}
      aria-pressed={selected}
      className={`w-full text-left flex gap-3 p-2 rounded-lg border transition-colors ${
        marked
          ? "border-primary/25 bg-secondary/40 opacity-60"
          : selected
            ? "border-primary bg-primary/10"
            : "border-border hover:bg-accent/50"
      }`}
    >
      <BookCover
        book={book}
        className="w-10 shrink-0 aspect-[2/3] rounded bg-muted overflow-hidden"
        fallback={null}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-1">{book.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
        {book.publisher && (
          <p className="text-xs text-muted-foreground line-clamp-1">{book.publisher} · {book.published_date}</p>
        )}
        {formats?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {formats.map((f) => (
              <Badge key={f} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                {formatLabel(f)}
              </Badge>
            ))}
          </div>
        )}
        {owned && <p className="text-xs text-primary mt-1">In your list</p>}
      </div>
      <span
        className={`w-7 h-7 shrink-0 self-center rounded-full border flex items-center justify-center ${
          selected || marked ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
        }`}
      >
        {busy
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : selected || marked
            ? <Check className="w-4 h-4" />
            : <Plus className="w-4 h-4" />}
      </span>
    </button>
  );
}