import React from "react";
import BookCover from "@/components/tbr/BookCover";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Plus } from "lucide-react";

// One book by this author from the catalogues: already on the reader's list, or waiting to
// be added to it.
function AuthorBookRow({ book, owned, busy, disabled, onAdd }) {
  const year = String(book.published_date || "").slice(0, 4);

  return (
    <div className="vp-panel flex gap-3 p-3">
      <div className="w-12 shrink-0 overflow-hidden rounded-lg bg-secondary aspect-[2/3]">
        <BookCover book={book} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm leading-tight">{book.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {[year, book.publisher].filter(Boolean).join(" \u00B7 ") || "\u00A0"}
        </p>
      </div>
      {owned ? (
        <span className="inline-flex items-center gap-1 self-center text-xs font-semibold text-primary">
          <Check className="h-4 w-4" strokeWidth={3} /> On your list
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 self-center gap-1.5 sm:min-h-9"
          disabled={disabled}
          onClick={() => onAdd(book)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </Button>
      )}
    </div>
  );
}

export default React.memo(AuthorBookRow);