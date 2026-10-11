// Whether a book found by search or scan is one the reader already has. A book is
// recognised by its ISBN, its catalogue id, or its title and author words, because the
// same book reaches the list from several places and rarely with the same identifiers.

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

export function ownedIndex(books = []) {
  const index = new Set();
  books.forEach((book) => {
    const isbn = isbnOf(book?.isbn);
    if (isbn) index.add(`isbn:${isbn}`);
    if (book?.google_books_id) index.add(`gb:${String(book.google_books_id).toLowerCase()}`);
    const title = titleKey(book);
    if (title) index.add(`ta:${title}|${authorKey(book)}`);
  });
  return index;
}

export function isOwned(book, index) {
  if (!index) return false;
  const isbn = isbnOf(book?.isbn);
  if (isbn && index.has(`isbn:${isbn}`)) return true;
  if (book?.google_books_id && index.has(`gb:${String(book.google_books_id).toLowerCase()}`)) return true;
  const title = titleKey(book);
  return !!title && index.has(`ta:${title}|${authorKey(book)}`);
}