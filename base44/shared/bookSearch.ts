// Shared book catalogue access, used by searchBooks, identifyBook, bookSeries and
// authorReleases. A search merges Google Books and Open Library, and retries with a
// tidier wording, so a book held by only one catalogue is still found.
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
  // `country=US` stops Google trimming its catalogue down to what is sold in the
  // caller's own region — the widest list of matches is what a search wants, and
  // only the bibliographic fields above are read, never its pricing.
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(googleQuery(query, type))}`
    + `&maxResults=20&printType=books&country=US${key ? `&key=${encodeURIComponent(key)}` : ''}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const error = new Error('Book lookup failed');
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  return (data.items || []).map(normalizeGoogleVolume).filter((book) => book.title);
}

// ---------- Answer cache ----------

// Open Library is free but limits how often one address may ask it, and Google's free key
// has a daily allowance, so an answer that has already been fetched is kept and reused.
// Repeat searches then cost no upstream lookup at all, which is what leaves more of the
// free allowance for searches nobody has run yet.
const CACHE_DAYS = 30;

// Punctuation and case are dropped, so the same search typed two ways — "The
// Housemaid: A Novel" and "the housemaid a novel" — reuses one stored answer.
function cacheKey(query, type) {
  const text = String(query || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${type}:${text.slice(0, 200)}`;
}

async function readCache(db, key) {
  try {
    const { items } = await db.asServiceRole.entities.BookSearchCache
      .filter({ cache_key: key }, { sort: '-created_date', limit: 1 });
    const hit = items[0];
    if (!hit || !Array.isArray(hit.books) || !hit.books.length) return null;

    const ageDays = (Date.now() - new Date(hit.created_date).getTime()) / 86400000;
    return ageDays > CACHE_DAYS ? null : hit.books;
  } catch {
    return null; // A cache that cannot be read is a miss, never a failed search.
  }
}

async function writeCache(db, key, books) {
  try {
    await db.asServiceRole.entities.BookSearchCache.create({ cache_key: key, books });
  } catch {
    // A search that found books is still a success if the answer cannot be kept.
  }
}

// ---------- Query variants ----------

// A reader types the title as it is printed — "Iron Flame (The Empyrean, #2)",
// "The Housemaid: A Novel" — while a catalogue matches the bare title far more
// readily. So an empty answer is retried with the decorations stripped before the
// search is reported as having found nothing.
const SERIES_TAIL = /\s*\((?:[^()]*)\)\s*$/;
const SUBTITLE_SPLIT = /\s*[:–—]\s*|\s+-\s+/;
const VOLUME_TAIL = /\s*(?:,|;|\s)\s*(?:(?:book|bk|vol|volume|part)\s*\.?\s*|#)\s*\d+(?:\s*[-–—]\s*\d+)?\s*\.?\s*$/i;
const QUOTE_NOISE = /["'’‘“”«»]+/g;
const LOOSE_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'novel', 'book', 'books', 'series']);

function tidyQuery(value) {
  return String(value || '').replace(QUOTE_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

// The main title alone: series and volume markers, then the subtitle, dropped.
function mainTitle(value) {
  let text = tidyQuery(value).replace(SERIES_TAIL, '').trim();
  text = text.split(SUBTITLE_SPLIT)[0].trim();
  text = text.replace(VOLUME_TAIL, '').trim();
  return text.replace(/[\s,;:–—-]+$/, '').trim();
}

// The first few meaningful words — the last resort when nothing else matched.
function looseQuery(value) {
  const words = mainTitle(value).toLowerCase().split(' ').filter((word) => word && !LOOSE_STOP.has(word));
  return words.slice(0, 4).join(' ');
}

function queryVariants(query, type) {
  const original = tidyQuery(query);
  if (!original) return [];

  // An ISBN carries no decorations, and an author's name rarely enough that a
  // retry is not worth the extra lookup.
  if (type === 'isbn') {
    const digits = original.replace(/[^0-9Xx]/g, '');
    return digits ? [digits] : [];
  }
  if (type === 'author') return [original];

  const seen = new Set();
  return [original, mainTitle(original), looseQuery(original)]
    .filter((variant) => {
      const key = variant.toLowerCase();
      if (!variant || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

// ---------- Merging the answers ----------

const cleanText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The words of a search that actually identify a book: filler words such as "a",
// "the" or "novel" say nothing, so they are left out of the comparison.
function significantWords(query) {
  return cleanText(query).split(' ').filter((word) => word.length > 1 && !LOOSE_STOP.has(word));
}

// Study guides and "summary of" editions are thick in the catalogues and would sit
// exactly where the reader looks for the book itself, so they are demoted — unless
// the search itself asked for one.
const COMPANION = /\b(?:summary|summarized|summarised|study guide|analysis|key takeaways|workbook|companion|quicklet|cliff ?notes|sparknotes)\b/i;

// How well a result answers what was typed: a title word counts for more than an
// author word, and an exact title wins outright, so the real book leads the list
// even when a loose retry brought back dozens of near-misses.
function relevance(book, query) {
  const title = cleanText(book.title);
  const author = cleanText(book.author);
  const wanted = cleanText(query);
  const typed = String(query || '');

  let score = 0;
  for (const word of wanted.split(' ').filter((word) => word.length > 1)) {
    if (title.includes(word)) score += 3;
    else if (author.includes(word)) score += 2;
  }

  // "Iron Flame (The Empyrean, #2)" — the book whose title is the opening of what was
  // typed is the one being asked for, ahead of any set that merely mentions it.
  if (wanted && title === wanted) score += 8;
  else if (wanted && wanted.startsWith(`${title} `)) score += 8;
  else if (wanted && title.startsWith(wanted)) score += 4;

  if (!COMPANION.test(typed) && COMPANION.test(`${book.title || ''} ${book.author || ''}`)) score -= 8;
  return score;
}

// An answer is trusted when some result carries the whole of what was typed in its
// title. A first attempt that only found near-misses — the summaries of a book, or a
// set that merely includes it — is worth a retry under the tidier wording.
function isConfident(books, query) {
  const wanted = significantWords(query);
  if (!wanted.length) return books.length > 0;
  return books.some((book) => {
    const title = cleanText(book.title);
    return title && wanted.every((word) => title.includes(word));
  });
}

// Both catalogues' answers, best match first, one row per book.
function mergeAnswers(lists, query, limit = 24) {
  const ranked = lists.flat()
    .filter((book) => book?.title)
    .map((book, index) => ({ book, index, score: relevance(book, query) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const seen = new Set();
  const merged = [];

  for (const { book } of ranked) {
    const title = cleanText(book.title);
    const titleKey = `title:${title}`;
    const isbnKey = book.isbn ? `isbn:${book.isbn}` : '';
    if (!title || seen.has(titleKey) || (isbnKey && seen.has(isbnKey))) continue;
    seen.add(titleKey);
    if (isbnKey) seen.add(isbnKey);
    merged.push(book);
    if (merged.length >= limit) break;
  }

  return merged;
}

// One attempt: both catalogues are asked at once, so a book held by only one of them
// still surfaces. Only when both fail does the attempt fail, which the endpoint
// reports as a lookup error rather than as "no books found".
async function searchAttempt(variant, type) {
  const [google, open] = await Promise.allSettled([
    googleBooksKey() ? searchGoogleBooks(variant, type) : Promise.resolve([]),
    searchOpenLibrary(variant, type),
  ]);

  if (google.status === 'rejected' && open.status === 'rejected') {
    throw open.reason || google.reason;
  }

  return [
    ...(google.status === 'fulfilled' ? google.value : []),
    ...(open.status === 'fulfilled' ? open.value : []),
  ];
}

// A reader waits on this call, so the retries share one budget: a catalogue that
// hangs cannot turn three attempts into half a minute of waiting.
const SEARCH_BUDGET_MS = 18000;

// The free catalogues together: Google Books when its free key is saved, because it
// answers on the app's own daily quota and carries descriptions, plus Open Library,
// which needs no key at all. The typed query is asked first; an answer that doesn't
// carry the book being asked for earns a retry under a tidier wording, and everything
// found along the way is ranked together. A trustworthy answer is kept, so a search
// that has been run before is served from the cache and costs no upstream lookup.
export async function searchBooks(query, type, db) {
  const key = cacheKey(query, type);
  const cached = await readCache(db, key);
  if (cached) return cached;

  const started = Date.now();
  const found = [];
  let answered = false;
  let lastError = null;
  let confident = false;

  for (const variant of queryVariants(query, type)) {
    if (Date.now() - started > SEARCH_BUDGET_MS) break;
    try {
      const books = await searchAttempt(variant, type);
      answered = true;
      found.push(...books);
      confident = isConfident(books, query);
      if (confident) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!answered && lastError) throw lastError;

  const books = mergeAnswers(found, query);
  // Near-misses are handed back but not kept, so a later search can still do better.
  if (books.length && confident) await writeCache(db, key, books);
  return books;
}