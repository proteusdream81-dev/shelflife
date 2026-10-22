// Shared book labels (reading format and series) used across the shelf UI.

export const BOOK_FORMATS = [
  { value: "paperback", label: "Paperback" },
  { value: "hardcover", label: "Hardcover" },
  { value: "ebook", label: "eBook" },
  { value: "kindle", label: "Kindle" },
  { value: "audiobook", label: "Audiobook" },
  { value: "other", label: "Other" },
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

// The series a book belongs to, taken from what the catalogue stored and falling back to the
// series printed in the title. Null when the book isn't part of one.
export const seriesOf = (book) => {
  const name = String(book?.series_name || "").trim();
  if (name) return { name, position: String(book?.series_position || "").trim() };
  return seriesFromTitle(book?.title);
};

export const FORMAT_VALUES = BOOK_FORMATS.map((format) => format.value);

// Every format a title is held in — the reader's own format plus any other editions they
// also own — so filtering by format answers to all of them.
export const formatsOf = (book) => {
  const listed = Array.isArray(book?.formats) ? book.formats : [];
  return [...new Set([book?.format, ...listed].filter((value) => FORMAT_VALUES.includes(value)))];
};

const LAST_FORMAT_KEY = "shelflife.format";

// The format a reader last chose, so adding the next book doesn't start over at paperback.
export const rememberedFormat = () => {
  try {
    const stored = window.localStorage?.getItem(LAST_FORMAT_KEY);
    return FORMAT_VALUES.includes(stored) ? stored : "paperback";
  } catch {
    return "paperback";
  }
};

export const rememberFormat = (value) => {
  try {
    if (FORMAT_VALUES.includes(value)) window.localStorage?.setItem(LAST_FORMAT_KEY, value);
  } catch {
    // A browser that won't keep it simply starts from paperback next time.
  }
};