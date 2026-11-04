import React from "react";
import { APP_ICON } from "@/lib/brand";

// The same mark the installed app and home-screen shortcut use. Website headers
// and auth screens share this so the brand is one artwork, not a generic glyph.
export default function BrandMark({ className = "", size = 42 }) {
  const px = typeof size === "number" ? size : 42;
  return (
    <div className={`vp-mark vp-mark-icon ${className}`.trim()}>
      <img
        src={APP_ICON}
        alt=""
        width={px}
        height={px}
        className="h-full w-full object-contain"
        decoding="async"
      />
    </div>
  );
}
