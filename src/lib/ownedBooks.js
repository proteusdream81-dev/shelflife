// Whether a book found by search or scan is one the reader already has. A book is
// recognised by its ISBN, its catalogue id, or its title and author words, because the
// same book reaches the list from several places and rarely with the same identifiers.
//
// A title held in one edition is not the same as the same title held in another: a reader
// with the paperback may also own the audiobook, so where the ask names an edition, only a
// copy in that edition counts as already held.

const isbnOf = (value) => String(value || "").replace(/[^0-9Xx]/g, "");

const wordsOf = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

const titleKey = (book) => wordsOf(book?.title).join(" ");

// Author words are sorted, so "King, Stephen" and "Stephen King" meet on the same key.
const authorKey = (book) => [...new Set(wordsOf(book?.author))].sort().join(" ");

const formatOf = (value) => String(value || "").trim().toLowerCase();

const editionKey = (key, format) => `${key}|f:${format}`;

const keysOf = (book) => {
  const keys = [];
  const isbn = isbnOf(book?.isbn);
  if (isbn) keys.push(`isbn:${isbn}`);
  if (book?.google_books_id) keys.push(`gb:${String(book.google_books_id).toLowerCase()}`);
  const title = titleKey(book);
  if (title) keys.push(`ta:${title}|${authorKey(book)}`);
  return keys;
};

const editionsOf = (book) => {
  const listed = Array.isArray(book?.formats) ? book.formats : [];
  return [...new Set([book?.format, ...listed].map(formatOf).filter(Boolean))];
};

export function ownedIndex(books = []) {
  const index = new Set();
  books.forEach((book) => {
    const editions = editionsOf(book);
    keysOf(book).forEach((key) => {
      index.add(key);
      editions.forEach((format) => index.add(editionKey(key, format)));
    });
  });
  return index;
}

export function isOwned(book, index, format) {
  if (!index) return false;
  const wanted = formatOf(format);
  const keys = keysOf(book);
  if (!wanted) return keys.some((key) => index.has(key));
  return keys.some((key) => index.has(editionKey(key, wanted)));
}