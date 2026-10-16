import React from "react";

// One clause of the policy: a small amber heading over its paragraph, with a hairline between
// clauses so the page reads as a list of short statements rather than one wall of text.
export default function PolicySection({ heading, body, last }) {
  return (
    <section className={last ? "" : "pb-5 mb-5 border-b border-primary/20"}>
      <h2 className="font-heading text-xs uppercase tracking-[.18em] text-primary">{heading}</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/85">{body}</p>
    </section>
  );
}