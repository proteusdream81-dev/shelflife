import React from "react";
import { Image } from "@/components/ui/image";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Check } from "lucide-react";

export default function BookResultRow({ book, onAdd, adding, added }) {
  return (
    <div className="flex gap-3 p-2 rounded-lg border border-border hover:bg-accent/50 transition-colors">
      <div className="w-10 shrink-0 aspect-[2/3] rounded bg-muted overflow-hidden">
        {book.cover_url && <Image src={book.cover_url} alt="" fittingType="fill" className="w-full h-full" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-1">{book.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
        {book.publisher && (
          <p className="text-xs text-muted-foreground line-clamp-1">{book.publisher} · {book.published_date}</p>
        )}
      </div>
      {onAdd && (
        <Button size="sm" variant="outline" onClick={() => onAdd(book)} disabled={adding || added}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : added ? <Check className="w-4 h-4 text-green-600" /> : <Plus className="w-4 h-4" />}
        </Button>
      )}
    </div>
  );
}