import React from "react";
import { FORMAT_FILTERS } from "@/lib/bookMeta";

export default function FormatFilter({ value, onChange }) {
  return (
    <div className="vp-formats" role="group" aria-label="Filter books by format">
      {FORMAT_FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          aria-pressed={value === f.value}
          className={`vp-btn vp-small ${value === f.value ? "vp-active" : ""}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}