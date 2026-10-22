import React from "react";
import { BookMarked } from "lucide-react";

// Where a book sits in its series, as one small line under its title: "Book 3 in The Empyrean".
// Nothing renders when the book isn't part of a series.
export default function SeriesLine({ name, position, className = "" }) {
  if (!name) return null;
  const number = String(position || "").trim();

  return (
    <p className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
      <BookMarked className="h-3 w-3 shrink-0" strokeWidth={1.8} />
      <span>{number ? `Book ${number} in ${name}` : name}</span>
    </p>
  );
}