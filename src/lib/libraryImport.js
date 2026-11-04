import { parseCsv, rowsToObjects } from "@/lib/csv";

// One reader's library arrives from whichever service they have kept it in — Goodreads,
// StoryGraph, LibraryThing, Bookmory or Handy Library. The column names differ; what a book
// *is* does not, so one set of candidate headings describes all of them, and the export's own
// separator is read off its header line.

const COLUMNS = {
  title: ["Title", "Book Title", "Name"],
  author: ["Author", "Authors", "Author (First, Last)", "Author (Last, First)", "Author l-f", "Writer"],
  isbn: ["ISBN13", "ISBN", "ISBN-13", "ISBN 13", "Isbn13", "Isbn", "ISBN/UID"],
  asin: ["ASIN", "Asin", "Kindle ASIN", "Amazon ASIN"],
  rating: ["My Rating", "Star Rating", "Rating", "My rating", "Stars", "Score"],
  status: ["Exclusive Shelf", "Read Status", "Status", "Reading Status"],
  collections: [
    "Collections", "Collection",
    "Bookshelves", "Bookshelf", "Bookshelf Name", "Book Shelf", "Bookshelves with positions",
    "Shelves", "Shelf",
    "Category", "Categories",
  ],
  format: ["Binding", "Format", "Media", "Type", "Edition Format"],
  review: ["My Review", "Review", "Review Text", "Review Content"],
  notes: ["Private Notes", "Notes", "Note", "Memo", "Comment", "Comments", "Summary"],
  publisher: ["Publisher", "Publishers", "Publisher(s)", "Imprint"],
  published_date: ["Year Published", "Publication Date", "Published Date", "Original Publication Year", "Year", "Date Published", "Published"],
  page_count: ["Number of Pages", "Pages", "Page Count", "Length"],
  date_read: ["Date Read", "Dates Read", "Last Date Read", "Finish Date", "Finished"],
  cover: ["Cover", "Cover URL", "Cover Url", "Cover Image", "Image URL", "Image"],
  shelf_location: [
    "Shelf Location", "Shelf Name", "Location", "Bookcase", "Bookcase Name",
    "Shelf Section", "Section", "Call", "Call Number",
    "Physical Location", "Storage Location", "Shelf (Location)", "Place",
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

const valuesFor = (row, map, names) => {
  const seen = new Set();
  const out = [];
  for (const name of names) {
    const key = map.get(normalise(name));
    if (!key) continue;
    const value = String(row[key] ?? "").trim();
    if (!value) continue;
    const nk = value.toLowerCase();
    if (seen.has(nk)) continue;
    seen.add(nk);
    out.push(value);
  }
  return out;
};

export function detectSource(header = []) {
  const has = (name) => header.some((h) => normalise(h) === normalise(name));
  if (has("Exclusive Shelf") || has("My Rating") || has("Bookshelves")) return "Goodreads";
  if (has("Read Status") || has("Star Rating") || has("ISBN/UID")) return "StoryGraph";
  if (has("Collections") || has("Author (Last, First)")) return "LibraryThing";
  if (has("Status") && (has("ASIN") || has("Memo") || has("Bookshelf") || has("Book Shelf"))) return "Bookmory";
  if (has("Location") || has("Call") || has("Category") || has("Section") || has("Bookshelf Name")) {
    return "Handy Library";
  }
  return "your library";
}

const ISBN10 = /^\d{9}[\dX]$/;
const ISBN13 = /^\d{13}$/;
const ASIN_SHAPE = /^[A-Z0-9]{10}$/;

export const cleanIsbn = (value) => {
  const text = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return ISBN10.test(text) || ISBN13.test(text) ? text : "";
};

export const cleanAsin = (value) => {
  const text = String(value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!ASIN_SHAPE.test(text)) return "";
  return ISBN10.test(text) || ISBN13.test(text) ? "" : text;
};

const identifierFor = (isbnValue, asinValue) => ({
  isbn: cleanIsbn(isbnValue),
  asin: cleanAsin(asinValue) || cleanAsin(isbnValue),
});

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

function isStatusOnly(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return STATUS_RULES.some((rule) => rule.test.test(text));
}

function statusFromCollections(value) {
  const parts = String(value || "").split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const rule = STATUS_RULES.find((candidate) => candidate.test.test(part));
    if (rule) return rule;
  }
  return null;
}

export function parseShelfNames(...values) {
  const seen = new Set();
  const names = [];
  values.forEach((value) => {
    String(value || "").split(/[,;|]/).forEach((part) => {
      const name = part.trim().replace(/\s+/g, " ");
      if (!name || name.length > 80) return;
      if (STATUS_RULES.some((rule) => rule.test.test(name))) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
  });
  return names.slice(0, 5);
}

const ROLE_RULES = [
  { role: "reading", test: /(currently[-\s]?reading|in progress|started|paused|on hold)/i },
  { role: "dnf",     test: /(did[-\s]?not[-\s]?finish|dnf|abandoned|gave up|not finished)/i },
  { role: "to_read", test: /(to[-\s]?read|tbr|want[-\s]?to[-\s]?read|wishlist|unread|not read)/i },
  { role: "read",    test: /\b(read|finished|completed|complete|done)\b/i },
];

export function shelfRole(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  return ROLE_RULES.find((rule) => rule.test.test(text))?.role || "";
}

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

export function shelfPlan(books = [], shelves = []) {
  const matcher = shelfMatcher(shelves);
  return Object.entries(shelfSummary(books)).map(([name, count]) => {
    const existing = matcher.find(name);
    return { name, count, existing: existing?.name || "", isNew: !existing };
  });
}

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
const titleAuthorKey = (book) => {
  const title = titleKey(book);
  return title ? `ta:${title}|${authorKey(book)}` : "";
};

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
    const collectionValues = valuesFor(row, map, COLUMNS.collections);
    const locationValues = valuesFor(row, map, COLUMNS.shelf_location);
    const collections = collectionValues.join(", ");
    const statusText = valueFor(row, map, COLUMNS.status);
    const statusFromColumn = statusText && isStatusOnly(statusText) ? statusFor(statusText) : null;
    const { status, shelf } = statusFromColumn
      || statusFromCollections(collections)
      || statusFor("");
    const shelves = parseShelfNames(
      ...collectionValues,
      ...locationValues,
      statusFromColumn ? "" : statusText
    );
    const rating = parseRating(valueFor(row, map, COLUMNS.rating));
    const pages = Number(String(valueFor(row, map, COLUMNS.page_count)).replace(/[^0-9]/g, "")) || 0;
    const format = formatFor(valueFor(row, map, COLUMNS.format)) || (asin && !isbn ? "kindle" : "");
    books.push({
      row: index + 2,
      key,
      title,
      author,
      isbn,
      asin,
      status,
      status_shelf: shelf,
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

export function shelfNamesFor(book) {
  const seen = new Set();
  const names = [];
  [book?.shelf_name, ...(book?.shelves || []), book?.status_shelf].forEach((value) => {
    const name = String(value || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

export function shelfSummary(books = []) {
  const counts = {};
  books.forEach((book) => {
    const names = shelfNamesFor(book);
    (names.length ? names : ["To Read"]).forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return counts;
}

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

export const findExisting = (book, index) =>
  index.get(importKey(book)) || index.get(titleAuthorKey(book)) || null;

export function toBookRecord(book, shelfId, otherShelfIds = []) {
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
    ...(otherShelfIds.length ? { shelf_ids: otherShelfIds } : {}),
    status: book.status,
    ...(book.rating > 0 ? { rating: book.rating } : {}),
    ...(book.format ? { format: book.format } : {}),
    enrichment_status: "failed",
    alt_covers: [],
  };
}

const METADATA_FIELDS = [
  "author", "isbn", "cover_url", "description", "publisher", "published_date",
  "page_count", "categories", "google_books_id", "series_name", "series_position",
];

export function metadataPatch(record, catalogue) {
  if (!record?.id || !catalogue) return null;
  const patch = { id: record.id };
  let filled = false;
  METADATA_FIELDS.forEach((field) => {
    if (record[field] || !catalogue[field]) return;
    patch[field] = catalogue[field];
    filled = true;
  });
  if (!filled && !catalogue.cover_url) return null;
  if (catalogue.cover_url && !record.cover_url) {
    patch.cover_url = catalogue.cover_url;
    filled = true;
  }
  if (!filled) return null;
  patch.enrichment_status = "enriched";
  return patch;
}

export function patchFilled(patch) {
  return Boolean(patch && Object.keys(patch).some((k) => k !== "id" && k !== "enrichment_status"));
}

export function shelfMembershipPatch(record, shelfIds = []) {
  if (!record?.id) return null;
  const have = new Set([record.shelf_id, ...(Array.isArray(record.shelf_ids) ? record.shelf_ids : [])]);
  const missing = [...new Set(shelfIds)].filter((id) => id && !have.has(id));
  if (!missing.length) return null;
  return { id: record.id, shelf_ids: [...(Array.isArray(record.shelf_ids) ? record.shelf_ids : []), ...missing] };
}
