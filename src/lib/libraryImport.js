import { parseCsv, rowsToObjects } from "@/lib/csv";

// One reader's library arrives from whichever service they have kept it in — Goodreads,
// StoryGraph, LibraryThing or Bookmory. The column names differ; what a book *is* does
// not, so one set of candidate headings describes all of them, and the export's own
// separator is read off its header line.

const COLUMNS = {
  title: ["Title", "Book Title", "Name"],
  author: ["Author", "Authors", "Author (First, Last)", "Author (Last, First)", "Author l-f", "Writer"],
  isbn: ["ISBN13", "ISBN", "ISBN-13", "ISBN 13", "Isbn13", "Isbn", "ISBN/UID"],
  asin: ["ASIN", "Asin", "Kindle ASIN", "Amazon ASIN"],
  rating: ["My Rating", "Star Rating", "Rating", "My rating", "Stars", "Score"],
  status: ["Exclusive Shelf", "Read Status", "Status", "Reading Status", "Shelf"],
  collections: ["Collections", "Bookshelves", "Shelves", "Tags"],
  format: ["Binding", "Format", "Media", "Type", "Edition Format"],
  notes: ["My Review", "Review", "Review Text", "Memo", "Notes", "Note", "Comment", "Comments"],
  publisher: ["Publisher", "Publishers", "Publisher(s)", "Imprint"],
  published_date: ["Year Published", "Publication Date", "Published Date", "Original Publication Year", "Year", "Date Published"],
  page_count: ["Number of Pages", "Pages", "Page Count", "Length"],
  date_read: ["Date Read", "Dates Read", "Last Date Read", "Finish Date", "Finished"],
  cover: ["Cover", "Cover URL", "Cover Url", "Cover Image", "Image URL", "Image"],
};

const normalise = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const headerMap = (header = []) => {
  const map = new Map();
  header.forEach((name) => {
    const key = normalise(name);
    if (key && !map.has(key)) map.set(key, name);
  });
  return map;
};

const valueFor = (row, map, names) => {
  for (const name of names) {
    const key = map.get(normalise(name));
    if (!key) continue;
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
};

// Whose export this is, said back to the reader so they can see it was read correctly.
export function detectSource(header = []) {
  const has = (name) => header.some((h) => normalise(h) === normalise(name));
  if (has("Exclusive Shelf") || has("My Rating") || has("Bookshelves")) return "Goodreads";
  if (has("Read Status") || has("Star Rating") || has("ISBN/UID")) return "StoryGraph";
  if (has("Collections") || has("Author (Last, First)")) return "LibraryThing";
  if (has("Status") && (has("ASIN") || has("Memo"))) return "Bookmory";
  return "your library";
}

// An ISBN is a shape, not a bag of digits: ten characters ending in a digit or X, or
// thirteen digits. A Kindle edition has no ISBN to give, and the services that keep one
// identifier column put its ASIN in that column instead — "B0BVZ8J5XQ" cleaned down to
// digits leaves "085X", which no ISBN rule accepts. Kept as an ISBN it sent every lookup
// after the wrong identifier, and a Kindle import arrived with no details and no cover.
const ISBN10 = /^\d{9}[\dX]$/;
const ISBN13 = /^\d{13}$/;
const ASIN_SHAPE = /^[A-Z0-9]{10}$/;

export const cleanIsbn = (value) => {
  const text = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return ISBN10.test(text) || ISBN13.test(text) ? text : "";
};

// A ten-character identifier that spells out an ISBN is that ISBN, never an ASIN.
export const cleanAsin = (value) => {
  const text = String(value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!ASIN_SHAPE.test(text)) return "";
  return ISBN10.test(text) || ISBN13.test(text) ? "" : text;
};

// Whichever identifier a row carries, wherever the export keeps it: the ISBN column of a
// Kindle-only export holds the ASIN, and Bookmory's ISBN column does the same.
const identifierFor = (isbnValue, asinValue) => ({
  isbn: cleanIsbn(isbnValue),
  asin: cleanAsin(asinValue) || cleanAsin(isbnValue),
});

// A reading status is said in the words of whichever service wrote the file.
const STATUS_RULES = [
  { test: /^(read|finished|completed|complete|done)$/i, status: "read", shelf: "Read" },
  { test: /(currently|reading|in progress|started|paused|on hold|re-?reading)/i, status: "reading", shelf: "Currently Reading" },
  { test: /(did not finish|dnf|abandoned|gave up|not finished)/i, status: "to_read", shelf: "Did Not Finish" },
  { test: /(to-?read|tbr|want to read|wishlist|unread|not read|on shelf|backlog|planned|owned)/i, status: "to_read", shelf: "To Read" },
];

export function statusFor(value) {
  const text = String(value || "").trim();
  return STATUS_RULES.find((rule) => rule.test.test(text)) || { status: "to_read", shelf: "To Read" };
}

// A service with no status column keeps the status among its collections — LibraryThing
// files a finished book under "Read" beside its subjects — so each collection is offered
// to the same rules on its own, and the first one that reads as a status names it.
function statusFromCollections(value) {
  const parts = String(value || "").split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const rule = STATUS_RULES.find((candidate) => candidate.test.test(part));
    if (rule) return rule;
  }
  return null;
}

// The binding a service records — "Kindle Edition", "Audible Audio", "Poche" — is what the
// app's format filter reads.
const BINDINGS = [
  { format: "paperback", test: /paperback|softcover|poche|broch/i },
  { format: "hardcover", test: /hardcover|hardback|gebunden/i },
  { format: "kindle", test: /kindle/i },
  { format: "ebook", test: /e-?book|electronic|digital|epub|pdf/i },
  { format: "audiobook", test: /audio|hörbuch|horbuch/i },
];

export function formatFor(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return BINDINGS.find((binding) => binding.test.test(text))?.format || "";
}

// Ratings arrive as "4", "4.0", "4 stars" or a quarter-star figure; the app's shelf shows
// whole stars, so a half star is kept and anything finer is rounded to it.
export function parseRating(value) {
  const number = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(5, Math.round(number * 2) / 2);
}

const webUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
};

const words = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
const titleKey = (book) => words(book?.title).join(" ");
const authorKey = (book) => [...new Set(words(book?.author))].sort().join(" ");

// The book itself, whatever identifiers it was written down with — the fallback key the
// same book answers to when one side of the comparison has no ISBN or ASIN to offer.
const titleAuthorKey = (book) => {
  const title = titleKey(book);
  return title ? `ta:${title}|${authorKey(book)}` : "";
};

// The one key a book is recognised by, wherever it came from: an ISBN names an edition
// exactly, an ASIN names a Kindle edition, and a title with its author catches the rest.
export function importKey(book) {
  const isbn = cleanIsbn(book?.isbn);
  if (isbn) return `isbn:${isbn}`;
  const asin = cleanAsin(book?.asin);
  if (asin) return `asin:${asin}`;
  return titleAuthorKey(book);
}

export function parseLibraryCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { source: "", books: [] };

  const header = rows[0];
  const map = headerMap(header);
  const source = detectSource(header);
  const seen = new Set();
  const books = [];

  rowsToObjects(rows).forEach((row, index) => {
    const title = valueFor(row, map, COLUMNS.title);
    if (!title) return;

    const { isbn, asin } = identifierFor(
      valueFor(row, map, COLUMNS.isbn),
      valueFor(row, map, COLUMNS.asin)
    );
    const author = valueFor(row, map, COLUMNS.author);
    const key = importKey({ isbn, asin, title, author });
    if (seen.has(key)) return;
    seen.add(key);

    const collections = valueFor(row, map, COLUMNS.collections);
    const statusText = valueFor(row, map, COLUMNS.status);
    // With no status column of its own, the export's collections are asked instead.
    const { status, shelf } = statusText
      ? statusFor(statusText)
      : statusFromCollections(collections) || statusFor("");
    const rating = parseRating(valueFor(row, map, COLUMNS.rating));
    const pages = Number(String(valueFor(row, map, COLUMNS.page_count)).replace(/[^0-9]/g, "")) || 0;
    // A Kindle export carries an ASIN and no ISBN, which is itself the format.
    const format = formatFor(valueFor(row, map, COLUMNS.format)) || (asin && !isbn ? "kindle" : "");

    books.push({
      row: index + 2,
      key,
      title,
      author,
      isbn,
      asin,
      status,
      shelf_name: shelf,
      rating,
      ...(format ? { format } : {}),
      ...(pages ? { page_count: pages } : {}),
      publisher: valueFor(row, map, COLUMNS.publisher),
      published_date: valueFor(row, map, COLUMNS.published_date),
      notes: valueFor(row, map, COLUMNS.notes),
      cover_url: webUrl(valueFor(row, map, COLUMNS.cover)),
      collections,
    });
  });

  return { source, books };
}

export function shelfSummary(books = []) {
  const counts = {};
  books.forEach((book) => {
    const name = book.shelf_name || "To Read";
    counts[name] = (counts[name] || 0) + 1;
  });
  return counts;
}

// What the reader already has, so the same book is never added twice.
export function existingIndex(books = []) {
  const index = new Map();
  books.forEach((book) => {
    const isbn = cleanIsbn(book?.isbn);
    if (isbn) index.set(`isbn:${isbn}`, book);
    const asin = cleanAsin(book?.asin);
    if (asin) index.set(`asin:${asin}`, book);
    const shared = titleAuthorKey(book);
    if (shared) index.set(shared, book);
  });
  return index;
}

// A book is the book the reader already has however either side wrote it down: matched on
// its ISBN or ASIN first, then on its title and author. Without that second look an import
// row carrying an ISBN — and the record saved without one — read as two different books and
// the same title was added a second time.
export const findExisting = (book, index) =>
  index.get(importKey(book)) || index.get(titleAuthorKey(book)) || null;

// What the reader's own export says about a book, as a record the app can store.
export function toBookRecord(book, shelfId) {
  return {
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    asin: book.asin,
    cover_url: book.cover_url,
    notes: book.notes,
    publisher: book.publisher,
    published_date: book.published_date,
    page_count: book.page_count || 0,
    categories: [],
    buy_links: [],
    shelf_id: shelfId,
    status: book.status,
    ...(book.rating > 0 ? { rating: book.rating } : {}),
    ...(book.format ? { format: book.format } : {}),
  };
}

// The catalogue fields an enrichment match may fill in on a record. Only what the record
// is missing is written, so a reader's own cover, format, notes and rating survive.
const METADATA_FIELDS = [
  "author", "isbn", "cover_url", "description", "publisher", "published_date",
  "page_count", "categories", "buy_links", "google_books_id", "series_name", "series_position", "format",
];

// A field counts as filled when it says something. An empty list, an empty string and a
// zero page count are all gaps a catalogue match may fill — treating zero as a value is
// what kept every imported book's page count at 0.
const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null || value === "") return false;
  return typeof value !== "number" || value > 0;
};

export function metadataPatch(record, match) {
  if (!record?.id || !match) return null;
  const patch = { id: record.id };
  let filled = 0;

  METADATA_FIELDS.forEach((field) => {
    const next = match[field];
    if (!hasValue(next)) return;
    if (hasValue(record[field])) return;
    patch[field] = next;
    filled += 1;
  });

  return filled ? patch : null;
}