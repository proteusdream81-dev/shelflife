import React from "react";
import { BookOpen } from "lucide-react";

// What stands in for a cover the reader has chosen to keep to themselves: the app's own plum
// panel with its mark, so a hidden shelf still looks like a shelf rather than a row of blanks.
export default function HiddenCover({ className = "vp-cover" }) {
  return (
    <div className={`${className} vp-hiddencover`} role="img" aria-label="Cover hidden">
      <span className="vp-hiddencover-in">
        <BookOpen strokeWidth={1.6} />
        <span>ShelfLife</span>
      </span>
    </div>
  );
}