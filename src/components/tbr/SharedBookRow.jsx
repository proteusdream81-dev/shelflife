import React from "react";
import { Button } from "@/components/ui/button";
import BookCover from "@/components/tbr/BookCover";
import { Check, Loader2, Plus } from "lucide-react";

// One book shown in another reader's library, with the same add-to-my-list action as the
// books of a shared shelf.
export default function SharedBookRow({ book, adding, added, onAdd }) {
  const key = `${book.isbn}|${book.title}`;

  return (
    <div className="flex gap-2 p-2 rounded-lg border border-border">
      <BookCover
        book={book}
        className="w-9 shrink-0 aspect-[2/3] rounded bg-muted overflow-hidden"
        fallback={null}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium line-clamp-2 leading-tight">{book.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        onClick={() => onAdd(book)}
        disabled={adding === key || added[key]}
        title="Add to my list"
      >
        {adding === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : added[key] ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Plus className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}