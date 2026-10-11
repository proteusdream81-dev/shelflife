// Shared book labels (reading format and series) used across the shelf UI.

export const BOOK_FORMATS = [
  { value: "paperback", label: "Paperback" },
  { value: "hardcover", label: "Hardcover" },
  { value: "ebook", label: "eBook" },
  { value: "kindle", label: "Kindle" },
  { value: "audiobook", label: "Audiobook" },
];

export const FORMAT_FILTERS = [{ value: "all", label: "All formats" }, ...BOOK_FORMATS];

export const formatLabel = (value) => BOOK_FORMATS.find((f) => f.value === value)?.label || "";

// A title usually prints the series itself — "Iron Flame (The Empyrean, #2)" — so a
// book saved before series were tracked still shows the series it belongs to.
const SERIES_IN_TITLE = /\(([^()]*?(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*\d+[^()]*)\)\s*$/i;
const SERIES_NUMBER = /(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*(\d+(?:\.\d+)?)/i;

export const seriesFromTitle = (title) => {
  const bracketed = String(title || "").match(SERIES_IN_TITLE);
  if (!bracketed) return null;

  const number = bracketed[1].match(SERIES_NUMBER);
  if (!number) return null;

  const name = bracketed[1].replace(SERIES_NUMBER, "").replace(/[\s,;:–—-]+$/, "").trim();
  return name ? { name, position: number[1] } : null;
};

// "Harry Potter · Book 3" — empty when the book isn't part of a series.
export const seriesLabel = (book) => {
  if (book?.series_name) {
    return book.series_position ? `${book.series_name} · Book ${book.series_position}` : book.series_name;
  }

  const fromTitle = seriesFromTitle(book?.title);
  return fromTitle ? `${fromTitle.name} · Book ${fromTitle.position}` : "";
};