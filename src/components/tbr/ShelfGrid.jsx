import React from "react";
import BookCard from "@/components/tbr/BookCard";
import { BOOK_FORMATS, seriesOf } from "@/lib/bookMeta";

// The books on one shelf, either as one grid or grouped — by the edition the reader holds, or
// by series with each series in reading order.

const gridOf = (books, shelves, showWarnings, onSaved, onRemoved) => (
  <div className="vp-covergrid">
    {books.map((book) => (
      <BookCard
        key={book.id}
        book={book}
        shelves={shelves}
        showWarnings={showWarnings}
        onSaved={onSaved}
        onRemoved={onRemoved}
      />
    ))}
  </div>
);

const Group = ({ title, count, children }) => (
  <section className="mt-4 first:mt-0">
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
      <span className="vp-badge">{count}</span>
    </p>
    {children}
  </section>
);

// A series position as a number, so "Book 2" sorts before "Book 10"; a book with no position
// sits after the numbered ones rather than in front of them.
const positionOf = (book) => {
  const value = Number.parseFloat(String(seriesOf(book)?.position ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

function byFormat(books) {
  const groups = BOOK_FORMATS.map((format) => ({
    title: format.label,
    books: books.filter((book) => (book.format || "") === format.value),
  }));
  const unfiled = books.filter((book) => !BOOK_FORMATS.some((format) => format.value === (book.format || "")));
  if (unfiled.length) groups.push({ title: "No format set", books: unfiled });
  return groups.filter((group) => group.books.length > 0);
}

function bySeries(books) {
  const groups = new Map();
  const loose = [];
  books.forEach((book) => {
    const series = seriesOf(book);
    if (!series?.name) {
      loose.push(book);
      return;
    }
    const key = series.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { title: `${series.name} series`, books: [] });
    groups.get(key).books.push(book);
  });

  const ordered = [...groups.values()]
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
    .map((group) => ({
      ...group,
      books: group.books.sort(
        (a, b) => positionOf(a) - positionOf(b) || String(a.title).localeCompare(String(b.title))
      ),
    }));

  return { ordered, loose };
}

export default function ShelfGrid({ books, shelves, group = "none", showWarnings, onSaved, onRemoved }) {
  if (group === "format") {
    return (
      <div>
        {byFormat(books).map((section) => (
          <Group key={section.title} title={section.title} count={section.books.length}>
            {gridOf(section.books, shelves, showWarnings, onSaved, onRemoved)}
          </Group>
        ))}
      </div>
    );
  }

  if (group === "series") {
    const { ordered, loose } = bySeries(books);
    return (
      <div>
        {ordered.map((section) => (
          <Group key={section.title} title={section.title} count={section.books.length}>
            {gridOf(section.books, shelves, showWarnings, onSaved, onRemoved)}
          </Group>
        ))}
        {/* Books outside a series stay as they are, with no heading over them. */}
        {loose.length > 0 && <div className="mt-4">{gridOf(loose, shelves, showWarnings, onSaved, onRemoved)}</div>}
      </div>
    );
  }

  return gridOf(books, shelves, showWarnings, onSaved, onRemoved);
}