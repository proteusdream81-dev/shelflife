import React from "react";
import { Flame, Share2, Upload } from "lucide-react";

const FEATURES = [
  {
    icon: Upload,
    title: "Import your Goodreads library",
    body: "Bring years of shelves across in one go. Covers, authors and ratings arrive with it, so nothing has to be retyped.",
  },
  {
    icon: Flame,
    title: "Spice ratings and tropes",
    body: "Rate the heat on a five-chilli scale and tag the tropes you came for, so the next romance is one tap away.",
  },
  {
    icon: Share2,
    title: "Share shelves with friends",
    body: "Turn any shelf into a link. Friends open it in a browser, no account needed, and want the app by the bottom of the list.",
  },
];

export default function FeatureBlurbs() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {FEATURES.map(({ icon: Icon, title, body }) => (
        <article key={title} className="vp-shelf">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-primary/15 text-primary mb-3">
            <Icon className="w-5 h-5" strokeWidth={1.9} />
          </div>
          <h2 className="font-heading text-lg text-foreground leading-snug">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        </article>
      ))}
    </section>
  );
}