import { parseCsv, rowsToObjects } from "@/lib/csv";

const SHELF_MAP = {
  read: { name: "Read", status: "read" },
  "currently-reading": { name: "Currently Reading", status: "reading" },
  "to-read": { name: "To Read", status: "to_read" },
};

export function cleanIsbn(value) {
  return String(value || "").replace(/[^0-9Xx]/g, "");
}

// Goodreads exports one row per book. Custom Goodreads shelves are not imported —
// each book lands on its main (exclusive) shelf: Read, Currently Reading or To Read.
export function parseGoodreadsCsv(text) {
  const rows = rowsToObjects(parseCsv(text));
  const books = [];
  const seen = new Set();

  rows.forEach((r) => {
    const title = (r["Title"] || "").trim();
    if (!title) return;

    const isbn = cleanIsbn(r["ISBN13"]) || cleanIsbn(r["ISBN"]);
    const key = (isbn || `${title}|${r["Author"] || ""}`).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const shelf = SHELF_MAP[(r["Exclusive Shelf"] || "").trim().toLowerCase()] || SHELF_MAP["to-read"];
    const rating = Number(r["My Rating"]) || 0;

    const book = {
      title,
      author: r["Author"] || "",
      isbn,
      publisher: r["Publisher"] || "",
      published_date: r["Year Published"] || "",
      page_count: Number(r["Number of Pages"]) || 0,
      cover_url: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : "",
      notes: r["My Review"] || "",
      shelf_name: shelf.name,
      status: shelf.status,
    };
    if (rating > 0) book.rating = rating;

    books.push(book);
  });

  return books;
}

export function shelfSummary(books) {
  const counts = {};
  books.forEach((b) => { counts[b.shelf_name] = (counts[b.shelf_name] || 0) + 1; });
  return counts;
}

export function bookKey(book) {
  const isbn = cleanIsbn(book.isbn);
  if (isbn) return isbn.toLowerCase();
  return `${book.title || ""}|${book.author || ""}`.toLowerCase();
}