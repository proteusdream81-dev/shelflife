import React from "react";

// The hero visual: six real-spined covers, drawn from the same tiles a reader's own shelf uses,
// so the promise of the headline is on screen before anyone scrolls.
const SHELF = [
  { title: "Fourth Wing", author: "Rebecca Yarros" },
  { title: "The Housemaid", author: "Freida McFadden" },
  { title: "Yellowface", author: "R. F. Kuang" },
  { title: "Iron Flame", author: "Rebecca Yarros" },
  { title: "Babel", author: "R. F. Kuang" },
  { title: "Lessons in Chemistry", author: "Bonnie Garmus" },
];

export default function ShelfShowcase() {
  return (
    <div className="lp-showcase vp-covergrid" aria-hidden="true">
      {SHELF.map((book) => (
        <div key={book.title} className="vp-book">
          <div className="vp-cover vp-art">
            <span>{book.title}</span>
          </div>
          <h3>{book.title}</h3>
          <p>{book.author}</p>
        </div>
      ))}
    </div>
  );
}