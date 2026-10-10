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

// "Harry Potter · Book 3" — empty when the book isn't part of a series.
export const seriesLabel = (book) => {
  if (!book?.series_name) return "";
  return book.series_position ? `${book.series_name} · Book ${book.series_position}` : book.series_name;
};