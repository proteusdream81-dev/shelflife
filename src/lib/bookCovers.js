const cleanIsbn = (value) => String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();

// Amazon addresses its product images by ISBN-10 — the ASIN a print book is given — so an
// ISBN-13 is converted to one. A 979-prefixed ISBN has no ISBN-10 at all, so it can't be
// looked up this way.
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

// Google sizes a cover by the zoom asked for. The catalogue's own link arrives at zoom=1 —
// a thumbnail that looks soft on a phone — so it is asked for again at a printable size.
export function googleCoverUrl(googleBooksId, zoom = 3) {
  const id = String(googleBooksId || "").trim();
  if (!id) return "";
  return `https://books.google.com/books/content?id=${encodeURIComponent(id)}&printsec=frontcover&img=1&zoom=${zoom}&source=gbs_api`;
}

const TARGET_GOOGLE_ZOOM = 3;

// A saved cover link is asked for again at the largest size the source publishes: Google
// answers a zoom=1 link with a 128px thumbnail and the same art at ~575px from zoom=3, and
// Open Library answers -M with 180px and -L with 316px. It is the same artwork, only sharper,
// so it is tried ahead of the saved link — which stays behind it as the fallback, since a
// source that has no large scan still has the small one. A link to anything else (a photo the
// reader uploaded, an Amazon image) is their own cover and is left exactly as it is.
export function largestSavedCover(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  // Google Books content URLs (books.google.com and some googleusercontent mirrors).
  const googleId = value.match(/[?&]id=([^&]+)/i);
  if (googleId && /google\.(com|usercontent\.com)/i.test(value) && /books/i.test(value)) {
    const zoomMatch = value.match(/[?&]zoom=(\d+)/i);
    const currentZoom = zoomMatch ? Number(zoomMatch[1]) : 1;
    // Already at or above the sharp size — no higher candidate from this URL alone.
    if (Number.isFinite(currentZoom) && currentZoom >= TARGET_GOOGLE_ZOOM) return "";
    return googleCoverUrl(decodeURIComponent(googleId[1]), TARGET_GOOGLE_ZOOM);
  }

  // Open Library: -S / -M (and rare -s) → -L, preserving any query string.
  if (/covers\.openlibrary\.org/i.test(value)) {
    const upgraded = value.replace(/-([SMs])(\.(?:jpe?g|png))(\?.*)?$/i, "-L$2$3");
    return upgraded !== value ? upgraded : "";
  }

  return "";
}

// Open Library answers at the size asked for: -L is the large cover, -M the small one.
export const openLibraryCover = (isbn, size = "L") => {
  const value = cleanIsbn(isbn);
  return value.length >= 10 ? `https://covers.openlibrary.org/b/isbn/${value}-${size}.jpg` : "";
};

// Prefer a higher-res form of every known URL (stored + alt covers), then fall back through
// catalogue sources. Deduped so a URL that is already large is not listed twice.
function withLargestFirst(urls = []) {
  const ordered = [];
  urls.forEach((url) => {
    const large = largestSavedCover(url);
    if (large) ordered.push(large);
    if (url) ordered.push(url);
  });
  return ordered;
}

// The cover sources for a book, in the order they are tried: the saved cover at its largest
// size, the saved cover itself, then the other art the catalogues hold for it — a real cover
// of another printing beats the title art any day — then Google by its volume id, Open
// Library by ISBN and Amazon. Any of them can answer with a blank image rather than an
// error, which the cover component handles by moving on to the next.
export function coverCandidates(book = {}) {
  const stored = String(book.cover_url || "").trim();
  const isbn = cleanIsbn(book.isbn);
  const alts = (Array.isArray(book.alt_covers) ? book.alt_covers : [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);

  return [
    ...withLargestFirst([stored, ...alts]),
    googleCoverUrl(book.google_books_id),
    openLibraryCover(isbn),
    amazonCoverUrl(book),
  ].filter((url, index, all) => url && all.indexOf(url) === index);
}
