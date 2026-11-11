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

const SERIES_IN_TITLE = /\(([^()]*?(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*\d+[^()]*)\)\s*$/i;
const SERIES_NUMBER = /(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*(\d+(?:\.\d+)?)/i;
const SERIES_WITH_NUMBER = /^(.*?)\s*(?:[-,–—]\s*)?(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b|\bband\b)?\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*\.?$/i;

function seriesFromTitle(title, subtitle = "") {
  const candidates = [];
  const bracketed = String(title || "").match(SERIES_IN_TITLE);
  if (bracketed) candidates.push(bracketed[1]);
  if (subtitle) candidates.push(String(subtitle));
  for (const value of candidates) {
    const number = value.match(SERIES_NUMBER);
    if (!number) continue;
    const name = value.replace(SERIES_NUMBER, "").replace(/[\s,;:–—-]+$/, "").trim();
    if (name) return { series_name: name, series_position: number[1] };
  }
  return null;
}

function parseSeriesText(raw) {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (!value || value.length > 120) return null;
  const match = value.match(SERIES_WITH_NUMBER);
  if (!match) return { name: value, position: "" };
  const name = match[1].trim().replace(/[\s,;:–—-]+$/, "");
  return name ? { name, position: match[2].replace(/\s+/g, "") } : { name: value, position: "" };
}

function editionIsEnglish(edition) {
  return Array.isArray(edition?.languages)
    && edition.languages.some((language) => String(language?.key || "").endsWith("/eng"));
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

const RELEASE_FIELDS = [...OPEN_LIBRARY_FIELDS, "publish_date"];
const RELEASE_DAY_FORMATS = [
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, build: (match) => `${match[1]}-${match[2]}-${match[3]}T00:00:00Z` },
  { pattern: /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/, build: (match) => `${match[1]} ${match[2]}, ${match[3]} 00:00:00 UTC` },
  { pattern: /^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/, build: (match) => `${match[2]} ${match[1]}, ${match[3]} 00:00:00 UTC` },
];

export function pickReleaseDate(publishDates) {
  const values = Array.isArray(publishDates) ? publishDates : [publishDates];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    for (const { pattern, build } of RELEASE_DAY_FORMATS) {
      const match = value.match(pattern);
      if (!match) continue;
      const parsed = new Date(build(match));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
  }
  return "";
}

export async function fetchAuthorReleasesDirect(author) {
  const name = String(author || "").trim();
  if (!name) return [];
  const query = `author:"${name.replace(/["\\\\]/g, " ")}"`;
  const url = `${OPEN_LIBRARY_URL}?q=${encodeURIComponent(query)}&sort=new&limit=60&fields=${RELEASE_FIELDS.join(",")}`;
  const data = await fetchJson(url, "Open Library release lookup", 12000);
  const releases = [];
  for (const doc of Array.isArray(data?.docs) ? data.docs : []) {
    const date = pickReleaseDate(doc?.publish_date);
    if (!date) continue;
    const book = normalizeOpenLibrary(doc);
    if (!book.title) continue;
    releases.push({ date, book });
  }
  return releases;
}

export async function fetchAuthorReleaseCalendarDirect(books = [], { now = new Date() } = {}) {
  const authors = [];
  const seenAuthors = new Set();
  for (const book of books) {
    for (const part of String(book?.author || "").split(/,\s*/)) {
      const name = part.trim();
      const key = name.toLowerCase();
      if (!name || seenAuthors.has(key)) continue;
      seenAuthors.add(key);
      authors.push(name);
    }
  }

  const selected = authors.slice(0, 24);
  if (!selected.length) return { releases: [], authors_scanned: 0, authors_total: 0 };

  const found = [];
  for (let i = 0; i < selected.length; i += 6) {
    const batch = selected.slice(i, i + 6);
    const settled = await Promise.allSettled(batch.map(fetchAuthorReleasesDirect));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") found.push({ author: batch[index], items: result.value });
    });
  }

  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const from = current - 365 * 86400000;
  const to = current + 1100 * 86400000;
  const candidates = [];
  for (const { author, items } of found) {
    for (const item of items) {
      const at = Date.parse(`${item.date}T00:00:00Z`);
      if (!Number.isFinite(at) || at < from || at > to) continue;
      const title = String(item.book.title || "");
      candidates.push({
        id: item.book.google_books_id || `${title.toLowerCase()}|${author.toLowerCase()}`,
        dedupe_key: `${title.toLowerCase()}|${author.toLowerCase()}`,
        title,
        author,
        date: item.date,
        cover_url: item.book.cover_url,
        isbn: item.book.isbn,
      });
    }
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set();
  const releases = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.dedupe_key)) continue;
    seen.add(candidate.dedupe_key);
    const { dedupe_key, ...release } = candidate;
    releases.push(release);
  }
  return { releases, authors_scanned: selected.length, authors_total: authors.length };
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

// Series names live on Open Library edition records. Prefer a clear title annotation;
// otherwise rank edition series by English-language evidence and frequency.
export async function fetchBookSeriesDirect(book = {}) {
  const fromTitle = seriesFromTitle(book?.title);
  if (fromTitle) return fromTitle;
  const workKey = await findWorkKey(book);
  if (!workKey) return {};
  const editions = await openLibraryJson(`https://openlibrary.org${workKey}/editions.json?limit=100`);
  const tally = new Map();
  for (const edition of editions?.entries || []) {
    const english = editionIsEnglish(edition);
    const values = Array.isArray(edition?.series) ? edition.series : [edition?.series];
    for (const value of values) {
      const parsed = parseSeriesText(value);
      if (!parsed) continue;
      const key = parsed.name.toLowerCase();
      const entry = tally.get(key) || { name: parsed.name, count: 0, english: 0, position: "" };
      entry.count += 1;
      if (english) entry.english += 1;
      if (!entry.position && parsed.position) entry.position = parsed.position;
      tally.set(key, entry);
    }
  }
  const candidates = [...tally.values()];
  if (!candidates.length) return {};
  const englishCandidates = candidates.filter((candidate) => candidate.english > 0);
  const pool = englishCandidates.length ? englishCandidates : candidates;
  pool.sort((a, b) => (b.english - a.english) || (b.count - a.count)
    || (Number(Boolean(b.position)) - Number(Boolean(a.position))) || (a.name.length - b.name.length));
  return { series_name: pool[0].name, series_position: pool[0].position };
}
