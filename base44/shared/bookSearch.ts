// Shared book catalogue access, used by searchBooks, identifyBook, bookSeries and
// authorReleases. Google Books is the primary source; Open Library fills its gaps.
import { secrets } from 'base44:runtime';

const FIELDS = 'title,author_name,isbn,publisher,publish_year,first_publish_year,number_of_pages_median,cover_edition_key,subject,edition_key,key';

// Amazon matches a title and author far more reliably than an ISBN — a book has
// several, and theirs is often a different edition — so its search uses those
// alone, with a lookup by ISBN offered alongside as the fallback.
function buildBuyLinks(isbn, title, author) {
  const amazonQuery = [title, author].filter(Boolean).join(' ').trim();
  const amazonSearch = (extra = '') => `https://www.amazon.com.au/s?k=${encodeURIComponent(amazonQuery)}${extra}`;

  const links = [];
  if (isbn) {
    links.push({ name: 'Bookfinder', url: `https://www.bookfinder.com/search/?isbn=${isbn}&mode=isbn&st=sr&ac=qr` });
  }
  if (amazonQuery) {
    links.push({ name: 'Amazon', url: amazonSearch() });
    links.push({ name: 'Kindle', url: amazonSearch('&i=digital-text') });
  }
  if (isbn) {
    links.push({ name: 'Amazon (ISBN)', url: `https://www.amazon.com.au/s?k=${isbn}` });
  }
  return links;
}

export function normalizeDoc(d) {
  const isbn = Array.isArray(d.isbn) ? (d.isbn.find((i) => i.length === 13) || d.isbn[0]) : '';
  let cover = '';
  if (d.cover_edition_key) cover = `https://covers.openlibrary.org/b/olid/${d.cover_edition_key}-M.jpg`;
  else if (isbn) cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

  const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');

  const buyLinks = buildBuyLinks(isbn, d.title, author);
  const publisher = Array.isArray(d.publisher) ? d.publisher[0] : (d.publisher || '');
  const year = d.first_publish_year || (Array.isArray(d.publish_year) ? d.publish_year[0] : d.publish_year) || '';

  return {
    google_books_id: d.key || (Array.isArray(d.edition_key) ? d.edition_key[0] : '') || isbn || '',
    title: d.title || '',
    author,
    isbn,
    cover_url: cover,
    description: '',
    publisher,
    published_date: String(year || ''),
    page_count: d.number_of_pages_median || 0,
    categories: Array.isArray(d.subject) ? d.subject.slice(0, 5) : [],
    buy_links: buyLinks,
  };
}

export async function searchOpenLibrary(query, type) {
  const kind = type || 'all';
  let q = query;
  if (kind === 'title') q = `title:${query}`;
  else if (kind === 'author') q = `author:${query}`;
  else if (kind === 'isbn') q = `isbn:${String(query).replace(/[^0-9Xx]/g, '')}`;

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=${FIELDS}&limit=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const error = new Error('Book lookup failed');
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return (data.docs || []).map(normalizeDoc).filter((b) => b && b.title);
}

// Open Library only carries a day-level publish_date for some editions — a bare
// year or month can't be placed on a calendar, so those are skipped.
const DAY_DATE_FORMATS = [
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, build: (m) => `${m[1]}-${m[2]}-${m[3]}T00:00:00Z` },
  { pattern: /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/, build: (m) => `${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC` },
  { pattern: /^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/, build: (m) => `${m[2]} ${m[1]}, ${m[3]} 00:00:00 UTC` },
];

export function pickReleaseDate(publishDates) {
  const values = Array.isArray(publishDates) ? publishDates : [publishDates];

  for (const raw of values) {
    const text = String(raw ?? '').trim();
    for (const { pattern, build } of DAY_DATE_FORMATS) {
      const match = text.match(pattern);
      if (!match) continue;
      const parsed = new Date(build(match));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
  }

  return '';
}

// Every dated edition we can find for one author, newest first.
export async function searchAuthorReleases(author) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(`author:"${author}"`)}`
    + `&sort=new&limit=60&fields=${FIELDS},publish_date`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    const error = new Error('Release lookup failed');
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const releases = [];

  for (const doc of data.docs || []) {
    const date = pickReleaseDate(doc.publish_date);
    if (!date) continue;
    const book = normalizeDoc(doc);
    if (!book.title) continue;
    releases.push({ date, book });
  }

  return releases;
}

// ---------- Series ----------

// Open Library keeps series names on edition records, where they are patchy,
// multilingual and mixed with the volume ("Harry Potter, 1"), so we gather
// every edition's value and keep the most convincing English one.
const SERIES_WITH_NUMBER = /^(.*?)\s*(?:[-,–—]\s*)?(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b|\bband\b)?\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*\.?$/i;

function parseSeriesText(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120) return null;

  const match = text.match(SERIES_WITH_NUMBER);
  if (!match) return { name: text, position: '' };

  const name = match[1].trim().replace(/[\s,;:–—-]+$/, '');
  if (!name) return { name: text, position: '' };
  return { name, position: match[2].replace(/\s+/g, '') };
}

function editionIsEnglish(edition) {
  return Array.isArray(edition?.languages)
    && edition.languages.some((lang) => String(lang?.key || '').endsWith('/eng'));
}

async function openLibraryJson(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function findWorkKey(isbn, title, author) {
  if (isbn) {
    const edition = await openLibraryJson(`https://openlibrary.org/isbn/${isbn}.json`);
    const key = edition?.works?.[0]?.key;
    if (key) return key;
  }
  const query = [title, author].filter(Boolean).join(' ').trim();
  if (!query) return '';
  const search = await openLibraryJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1&fields=key`);
  return search?.docs?.[0]?.key || '';
}

// The series a book belongs to, as { series_name, series_position }.
export async function lookupSeries({ isbn, title, author }) {
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '');
  const workKey = await findWorkKey(clean, title, author);
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
      const entry = tally.get(key) || { name: parsed.name, count: 0, english: 0, position: '' };
      entry.count += 1;
      if (english) entry.english += 1;
      if (!entry.position && parsed.position) entry.position = parsed.position;
      tally.set(key, entry);
    }
  }

  const candidates = [...tally.values()];
  if (!candidates.length) return {};

  const englishOnes = candidates.filter((c) => c.english > 0);
  const pool = englishOnes.length ? englishOnes : candidates;
  pool.sort((a, b) => (b.english - a.english) || (b.count - a.count)
    || (Number(!!b.position) - Number(!!a.position)) || (a.name.length - b.name.length));

  const best = pool[0];
  return { series_name: best.name, series_position: best.position };
}

// ---------- Google Books (primary catalogue) ----------

// Google Books carries the publisher's own record — title, author, ISBN, page count,
// publisher, publication date, subjects and, unlike Open Library, a description — and
// it is not publicly editable, so no reader can change what a search returns.
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

// A key from Google Cloud is optional: without one the request still works, but on
// Google's shared anonymous quota. `secrets.get` throws when nothing is set, so this
// reads it defensively rather than failing a search over a missing upgrade.
function googleBooksKey() {
  try {
    return String(secrets.get('GOOGLE_BOOKS_API_KEY') || '').trim();
  } catch {
    return '';
  }
}

function googleQuery(query, type) {
  const text = String(query || '').replace(/["\\]/g, ' ').trim().slice(0, 200);
  if (type === 'title') return `intitle:${text}`;
  if (type === 'author') return `inauthor:${text}`;
  if (type === 'isbn') return `isbn:${text.replace(/[^0-9Xx]/g, '')}`;
  return text;
}

function normalizeGoogleVolume(volume) {
  const info = volume?.volumeInfo || {};
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const identifier = (kind) => identifiers.find((entry) => entry?.type === kind)?.identifier || '';
  const isbn = (identifier('ISBN_13') || identifier('ISBN_10')).replace(/[^0-9Xx]/g, '');
  const title = String(info.title || '').trim();
  const author = Array.isArray(info.authors) ? info.authors.join(', ') : String(info.authors || '');
  const thumbnail = String(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '');

  return {
    google_books_id: String(volume?.id || '') || isbn,
    title,
    author,
    isbn,
    cover_url: thumbnail.replace(/^http:/, 'https:'),
    description: String(info.description || '').trim(),
    publisher: String(info.publisher || ''),
    published_date: String(info.publishedDate || ''),
    page_count: Number(info.pageCount) || 0,
    categories: Array.isArray(info.categories) ? info.categories.slice(0, 5) : [],
    buy_links: buildBuyLinks(isbn, title, author),
  };
}

async function searchGoogleBooks(query, type) {
  const key = googleBooksKey();
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(googleQuery(query, type))}`
    + `&maxResults=20&printType=books${key ? `&key=${encodeURIComponent(key)}` : ''}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const error = new Error('Book lookup failed');
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  return (data.items || []).map(normalizeGoogleVolume).filter((book) => book.title);
}

// Google Books answers first; Open Library fills in what it does not carry, so a gap
// in one catalogue never leaves a search empty. It is an error only when neither
// answers, which is the case the caller reports as a failure.
export async function searchBooks(query, type) {
  const google = await searchGoogleBooks(query, type).catch(() => null);
  if (google?.length) return google;

  const openLibrary = await searchOpenLibrary(query, type).catch(() => null);
  if (openLibrary) return openLibrary;
  if (google) return [];
  throw new Error('Book lookup failed');
}