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
  // The shelves a row was filed under. StoryGraph's own "Tags" column holds moods and paces
  // rather than shelves, so it is not read as one.
  collections: ["Collections", "Bookshelves", "Bookshelves with positions", "Shelves"],
  format: ["Binding", "Format", "Media", "Type", "Edition Format"],
  // A review is what the reader thought of the book and travels with it to their reading
  // circle; private notes never leave them. Both exports keep the two in separate columns.
  review: ["My Review", "Review", "Review Text", "Review Content"],
  notes: ["Private Notes", "Notes", "Note", "Memo", "Comment", "Comments"],
  publisher: ["Publisher", "Publishers", "Publisher(s)", "Imprint"],
  published_date: ["Year Published", "Publication Date", "Published Date", "Original Publication Year", "Year", "Date Published"],
  page_count: ["Number of Pages", "Pages", "Page Count", "Length"],
  date_read: ["Date Read", "Dates Read", "Last Date Read", "Finish Date", "Finished"],
  cover: ["Cover", "Cover URL", "Cover Url", "Cover Image", "Image URL", "Image"],
  // Where the copy physically sits — the shelf a library app keeps it on: "Section 1 - Shelf 1".
  shelf_location: [
    "Shelf Location", "Shelf Name", "Location", "Bookcase", "Shelf Section",
    "Physical Location", "Storage Location", "Shelf (Location)",
  ],
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
  { test: /^(read|finished|completed|complete|done)$/i, status: "read", shelf: "Read", role: "read" },
  { test: /(currently|reading|in progress|started|paused|on hold|re-?reading)/i, status: "reading", shelf: "Currently Reading", role: "reading" },
  { test: /(did not finish|dnf|abandoned|gave up|not finished)/i, status: "to_read", shelf: "Did Not Finish", role: "dnf" },
  { test: /(to-?read|tbr|want to read|wishlist|unread|not read|on shelf|backlog|planned|owned)/i, status: "to_read", shelf: "To Read", role: "to_read" },
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

// The shelves a row actually names: the custom bookshelves a Goodreads or StoryGraph row was
// filed under, and the physical location an app like Handy Library records for the copy
// ("Section 1 - Shelf 1"). A word that only says how the book was read — "read",
// "currently-reading" — is a status rather than a shelf, and is left to the status mapping.
export function parseShelfNames(...values) {
  const seen = new Set();
  const names = [];
  values.forEach((value) => {
    String(value || "").split(/[,;|]/).forEach((part) => {
      const name = part.trim().replace(/\s+/g, " ");
      if (!name || name.length > 60) return;
      if (STATUS_RULES.some((rule) => rule.test.test(name))) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
  });
  return names.slice(0, 3);
}

// The part a shelf plays, read from its own name: an export's "to-read" is the to-read part,
// and so is a reader's "TBR" or "Want to Read". Only a name that is nothing but that part
// matches — a shelf called "Owned" is a shelf in its own right, not another way of saying To
// Read — so a custom shelf is never folded into a standard one by acciden
  const ROLE_RULES = [
      { role: "reading", test: /(currently[-\s]?reading|in progress|started|paused|on hold)/i },
        { role: "dnf",     test: /(did[-\s]?not[-\s]?finish|dnf|abandoned|gave up|not finished)/i },
          { role: "to_read", test: /(to[-\s]?read|tbr|want[-\s]?to[-\s]?read|wishlist|unread|not read)/i },
            { role: "read",    test: /\b(read|finished|completed|complete|done)\b/i },
            ];
  ]

export function shelfRole(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  return ROLE_RULES.find((rule) => rule.test.test(text))?.role || "";
}

// The reader's own shelves, so an imported library arrives on the shelves they already keep
// rather than beside them: the export's "to-read" is filed on their "TBR", its
// "currently-reading" on their "Reading". A name they have nothing for is matched on its
// wording alone, and a shelf made part-way through an import is remembered, so every book
// naming it lands on that same shelf.
export function shelfMatcher(shelves = []) {
  const byName = new Map();
  const byRole = new Map();

  const remember = (shelf) => {
    const name = String(shelf?.name || "").trim().toLowerCase();
    if (!name) return shelf;
    if (!byName.has(name)) byName.set(name, shelf);
    const role = shelfRole(name);
    if (role && !byRole.has(role)) byRole.set(role, shelf);
    return shelf;
  };

  (shelves || []).forEach(remember);

  return {
    remember,
    find: (name) => {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return null;
      return byName.get(key) || byRole.get(shelfRole(key)) || null;
    },
  };
}

// Where every shelf in the export will land, worked out before anything is written, so the
// import can be shown to the reader first instead of surprising them afterwards.
export function shelfPlan(books = [], shelves = []) {
  const matcher = shelfMatcher(shelves);
  return Object.entries(shelfSummary(books)).map(([name, count]) => {
    const existing = matcher.find(name);
    return { name, count, existing: existing?.name || "", isNew: !existing };
  });
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
    // The reader's own shelf structure comes across with the books: the shelves the export
    // names are made on import and the book is filed on the first of them, with the reading
    // status kept as its own value. A row naming no shelf lands on the shelf its status names.
    const shelves = parseShelfNames(collections, valueFor(row, map, COLUMNS.shelf_location), statusText);
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
      shelf_name: shelves[0] || shelf,
      shelves,
      rating,
      ...(format ? { format } : {}),
      ...(pages ? { page_count: pages } : {}),
      publisher: valueFor(row, map, COLUMNS.publisher),
      published_date: valueFor(row, map, COLUMNS.published_date),
      review: valueFor(row, map, COLUMNS.review),
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
    review: book.review,
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
    // The book is created with the reader's own data, before any catalogue has been asked,
    // so it starts as an unmatched record and becomes an enriched one when a confident match
    // arrives. A book nothing could be found for keeps the failed mark, which is what makes
    // a wrong-or-missing match visible on its own page.
    enrichment_status: "failed",
    alt_covers: [],
  };
}

// The catalogue fields an enrichment match may fill in on a record. Only what the record
// is missing is written, so a reader's own cover, format, notes and rating survive.
const METADATA_FIELDS = [
  "author", "isbn", "cover_url", "description", "publisher", "published_date",
  "page_count", "categories", "buy_links", "google_books_id", "series_name", "series_position", "format",
  // Filled in from the supplementary catalogue the same way, so an imported book benefits
  // from that source without the import flow itself changing.
  "hardcover_id", "community_rating", "community_ratings_count",
];

// A field counts as filled when it says something. An empty list, an empty string and a
// zero page count are all gaps a catalogue match may fill — treating zero as a value is
// what kept every imported book's page count at 0.
const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null || value === "") return false;
  return typeof value !== "number" || value > 0;
};

// True when a patch actually brings details, rather than only recording that the book was
// matched.
export const patchFilled = (patch) => Object.keys(patch || {})
  .some((key) => key !== "id" && key !== "enrichment_status");

export function metadataPatch(record, match, covers = []) {
  if (!record?.id || !match) return null;
  // A detail the reader corrected by hand is theirs: enrichment fills gaps and never
  // overrules a value somebody typed in themselves.
  const edited = new Set(Array.isArray(record.edited_fields) ? record.edited_fields : []);
  const patch = { id: record.id };
  let filled = 0;

  METADATA_FIELDS.forEach((field) => {
    if (edited.has(field)) return;
    const next = match[field];
    if (!hasValue(next)) return;
    if (hasValue(record[field])) return;
    patch[field] = next;
    filled += 1;
  });

  // The art the other editions carry, kept on the record so a shelf shows a real cover even
  // when the matched record brought none.
  const known = [...(Array.isArray(record.alt_covers) ? record.alt_covers : []), record.cover_url]
    .filter((url) => hasValue(url));
  const fresh = (Array.isArray(covers) ? covers : [])
    .filter((url) => /^https?:\/\//.test(String(url || "")) && !known.includes(url));
  if (fresh.length) {
    patch.alt_covers = [...known, ...fresh];
    filled += 1;
  }

  // A confident match is what an enriched record means, whether or not it had anything left
  // to add.
  patch.enrichment_status = "enriched";
  return patch;
}