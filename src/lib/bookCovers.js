const cleanIsbn = (value) => String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();

// Amazon addresses its product images by ISBN-10 — the ASIN a print book is
// given — so an ISBN-13 is converted to one. A 979-prefixed ISBN has no ISBN-10
// at all, so it can't be looked up this way.
export function isbn10(value) {
  const isbn = cleanIsbn(value);
  if (isbn.length === 10) return /^\d{9}[\dX]$/.test(isbn) ? isbn : "";
  if (!/^978\d{10}$/.test(isbn)) return "";

  const core = isbn.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : check}`;
}

// The cover Amazon holds for a book, used when the other sources have none.
export function amazonCoverUrl(book = {}) {
  const asin = isbn10(book.isbn);
  return asin ? `https://m.media-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg` : "";
}

// The cover sources for a book, in the order they are tried: the cover it
// already carries, then Open Library by its ISBN, then Amazon.
export function coverCandidates(book = {}) {
  const isbn = cleanIsbn(book.isbn);
  return [
    String(book.cover_url || "").trim(),
    isbn.length >= 10 ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : "",
    amazonCoverUrl(book),
  ].filter((url, index, all) => url && all.indexOf(url) === index);
}