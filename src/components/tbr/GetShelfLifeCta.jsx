import React from "react";
import { Download } from "lucide-react";
import { APP_ICON } from "@/lib/brand";
import { PLAY_STORE_URL } from "@/lib/reviewPrompt";

// The end of a public shelf: a reader who has just scrolled a friend's list is the best person
// to install the app, so the way to do it sits right under the last cover.
export default function GetShelfLifeCta({ className = "" }) {
  return (
    <section className={`vp-panel flex flex-col sm:flex-row items-center gap-4 p-5 text-center sm:text-left ${className}`}>
      <img
        src={APP_ICON}
        alt=""
        width="48"
        height="48"
        className="w-12 h-12 rounded-2xl shrink-0"
        loading="lazy"
        decoding="async"
      />
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-lg text-foreground">Get ShelfLife</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Keep your own pile in order. Scan a barcode and the book lands on a shelf.
        </p>
      </div>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="vp-btn vp-primary shrink-0"
      >
        <Download />
        Get it on Google Play
      </a>
    </section>
  );
}