import React from "react";
import PolicyBlocks from "@/components/legal/PolicyBlocks";

// One clause of a policy page: a small amber heading over its paragraphs, with a hairline between
// clauses so the page reads as a list of short statements rather than one wall of text.
export default function PolicySection({ heading, blocks, body, last }) {
  return (
    <section className={last ? "" : "pb-5 mb-5 border-b border-primary/20"}>
      <h2 className="font-heading text-xs uppercase tracking-[.18em] text-primary">{heading}</h2>
      {blocks ? (
        <PolicyBlocks blocks={blocks} />
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-foreground/85">{body}</p>
      )}
    </section>
  );
}