// Public catalogue lookups run in the reader's browser, not through Base44 functions.
// Requests therefore use the reader's own internet connection and do not consume
// ShelfLife/Base44 integration credits. No API keys or user credentials are required.
const GOOGLE_URL = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_FIELDS = [
  "title", "author_name", "isbn", "publisher", "publish_year",
  "first_publish_year", "number_of_pages_median", "cover_edition_key",
  "subject", "key", "edition_key",
];

const cleanIsbn = (value) => String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();

function buyLinks(isbn, title, author) {
  const term = [title, author].filter(Boolean).join(" ").trim() || isbn;
  const links = [];
  if (term) links.push({ name: "Amazon", url: `https://www.amazon.com.au/s?k=${encodeURIComponent(term)}` });
  if (isbn) links.push({ name: "Bookfinder", url: `https://www.bookfinder.com/search/?isbn=${encodeURIComponent(isbn)}&mode=isbn&st=sr&ac=qr` });
  return links;
}

function seriesFromTitle(title, subtitle = "") {
  const pattern = /\(([^()]*?(?:#|\bbook\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*\d+[^()]*)\)\s*$/i;
  const numberPattern = /(?:#|\bbook\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*(\d+(?:\.\d+)?)/i;
  const match = String(title || "").match(pattern);
  for (const value of [match?.[1], subtitle].filter(Boolean)) {
    const number = String(value).match(numberPattern);
    if (!number) continue;
    const name = String(value).replace(numberPattern, "").replace(/[\s,;:–—-]+$/, "").trim();
    if (name) return { series_name: name, series_position: number[1] };
  }
  return null;
}

function normalizeGoogle(volume) {
  const info = volume?.volumeInfo || {};
  const ids = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const isbn = cleanIsbn(
    ids.find((item) => item?.type === "ISBN_13")?.identifier
      || ids.find((item) => item?.type === "ISBN_10")?.identifier,
  );
  const title = String(info.title || "").trim();
  const author = Array.isArray(info.authors) ? info.authors.join(", ") : String(info.authors || "");
  const cover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "";
  const series = seriesFromTitle(title, info.subtitle);
  return {
    google_books_id: String(volume?.id || "") || isbn,
    title,
    author,
    isbn,
    cover_url: String(cover).replace(/^http:/, "https:"),
    description: String(info.description || ""),
    publisher: String(info.publisher || ""),
    published_date: String(info.publishedDate || ""),
    page_count: Number(info.pageCount) || 0,
    categories: Array.isArray(info.categories) ? info.categories.slice(0, 5) : [],
    buy_links: buyLinks(isbn, title, author),
    ...(series || {}),
  };
}

function normalizeOpenLibrary(doc) {
  const isbns = Array.isArray(doc?.isbn) ? doc.isbn : [];
  const isbn = cleanIsbn(isbns.find((value) => cleanIsbn(value).length === 13) || isbns[0]);
  const title = String(doc?.title || "").trim();
  const author = Array.isArray(doc?.author_name) ? doc.author_name.join(", ") : "";
  const publisher = Array.isArray(doc?.publisher) ? doc.publisher[0] || "" : "";
  const year = doc?.first_publish_year || doc?.publish_year?.[0] || "";
  const cover = doc?.cover_edition_key
    ? `https://covers.openlibrary.org/b/olid/${encodeURIComponent(doc.cover_edition_key)}-M.jpg`
    : isbn ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg` : "";
  const series = seriesFromTitle(title);
  return {
    google_books_id: String(doc?.key || doc?.edition_key?.[0] || isbn),
    title,
    author,
    isbn,
    cover_url: cover,
    description: "",
    publisher,
    published_date: String(year || ""),
    page_count: Number(doc?.number_of_pages_median) || 0,
    categories: Array.isArray(doc?.subject) ? doc.subject.slice(0, 5) : [],
    buy_links: buyLinks(isbn, title, author),
    ...(series || {}),
  };
}

async function fetchJson(url, label, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

function queryFor(query, type) {
  const text = String(query || "").replace(/["\\\\]/g, " ").trim().slice(0, 200);
  if (type === "isbn") return cleanIsbn(text);
  if (type === "title") return `title:${text}`;
  if (type === "author") return `author:${text}`;
  return text;
}

function dedupe(books) {
  const seen = new Set();
  return books.filter((book) => {
    const isbn = cleanIsbn(book.isbn);
    const key = isbn
      ? `isbn:${isbn}`
      : `title:${String(book.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|author:${String(book.author || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (!book.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchBooksDirect(query, type = "all") {
  const text = String(query || "").trim().slice(0, 200);
  if (!text) throw new Error("Enter a title, author or ISBN to search.");
  const googleQuery = type === "isbn" ? cleanIsbn(text) : text.replace(/["\\\\]/g, " ");
  const openQuery = queryFor(text, type);
  const googleUrl = `${GOOGLE_URL}?q=${encodeURIComponent(googleQuery)}&maxResults=20&printType=books`;
  const openUrl = `${OPEN_LIBRARY_URL}?q=${encodeURIComponent(openQuery)}&fields=${OPEN_LIBRARY_FIELDS.join(",")}&limit=20`;

  const [google, openLibrary] = await Promise.allSettled([
    fetchJson(googleUrl, "Google Books"),
    fetchJson(openUrl, "Open Library"),
  ]);
  const googleBooks = google.status === "fulfilled"
    ? (Array.isArray(google.value?.items) ? google.value.items : []).map(normalizeGoogle)
    : [];
  const openBooks = openLibrary.status === "fulfilled"
    ? (Array.isArray(openLibrary.value?.docs) ? openLibrary.value.docs : []).map(normalizeOpenLibrary)
    : [];

  if (google.status === "rejected" && openLibrary.status === "rejected") {
    throw new Error("Neither Google Books nor Open Library could be reached. Check your connection and try again.");
  }
  return {
    books: dedupe([...googleBooks, ...openBooks]),
    partial: google.status === "rejected" || openLibrary.status === "rejected",
  };
}

async function openLibraryJson(url) {
  try {
    return await fetchJson(url, "Open Library", 12000);
  } catch {
    return null;
  }
}

async function findWorkKey({ isbn, title, author }) {
  const clean = cleanIsbn(isbn);
  if (clean) {
    const edition = await openLibraryJson(`https://openlibrary.org/isbn/${encodeURIComponent(clean)}.json`);
    const key = edition?.works?.[0]?.key;
    if (key) return key;
  }
  const query = [title, author].filter(Boolean).join(" ").trim();
  if (!query) return "";
  const search = await openLibraryJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1&fields=key`);
  return search?.docs?.[0]?.key || "";
}

// Edition formats are public Open Library metadata and are fetched directly by the reader.
const FORMAT_PATTERNS = [
  ["paperback", /paperback|softcover|poche|broch|taschenbuch/i],
  ["hardcover", /hardcover|hardback|gebunden|reli|cartonn|tapa dura/i],
  ["ebook", /e-?book|electronic|epub|digital|electr[oó]nico/i],
  ["kindle", /kindle/i],
  ["audiobook", /audio|h[oö]rbuch/i],
];

export async function fetchBookFormatsDirect(book = {}) {
  const workKey = await findWorkKey(book);
  if (!workKey) return [];
  const editions = await openLibraryJson(`https://openlibrary.org${workKey}/editions.json?limit=100`);
  const found = new Set();
  for (const edition of editions?.entries || []) {
    const value = String(edition?.physical_format || "");
    for (const [format, pattern] of FORMAT_PATTERNS) {
      if (pattern.test(value)) found.add(format);
    }
  }
  return FORMAT_PATTERNS.map(([format]) => format).filter((format) => found.has(format));
}
