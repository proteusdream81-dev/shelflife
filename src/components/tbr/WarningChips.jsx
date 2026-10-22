import React from "react";
import { AlertTriangle } from "lucide-react";

// The content warnings tagged on a book. On a book's own page every tag is listed; on a shelf
// card only the first two are, so a card stays one tidy size.
export default function WarningChips({ warnings = [], limit = 0, className = "" }) {
  if (!warnings.length) return null;
  const shown = limit > 0 ? warnings.slice(0, limit) : warnings;
  const rest = warnings.length - shown.length;

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-destructive/45 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground"
        >
          {tag}
        </span>
      ))}
      {rest > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-destructive/45 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
          <AlertTriangle className="h-2.5 w-2.5" /> +{rest}
        </span>
      )}
    </span>
  );
}