import React from "react";
import { CLUB_CATEGORIES } from "@/lib/clubCategories";

// The subject row, wherever clubs are picked by subject: browsing the clubs in the app, and
// searching the clubs out in the world. An empty value is "all subjects".
export default function CategoryChips({ value, onChange, allLabel = "All subjects" }) {
  return (
    <div className="vp-formats" role="group" aria-label="Club subjects">
      {["", ...CLUB_CATEGORIES].map((category) => {
        const active = value === category;
        return (
          <button
            key={category || "all"}
            type="button"
            onClick={() => onChange(category)}
            aria-pressed={active}
            className={`vp-btn vp-small ${active ? "vp-active" : ""}`}
          >
            {category || allLabel}
          </button>
        );
      })}
    </div>
  );
}