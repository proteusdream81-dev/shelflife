// Shared book catalogue access, used by searchBooks, identifyBook, bookSeries and
// authorReleases. A search merges Google Books and Open Library, and retries with a
// tidier wording, so a book held by only one catalogue is still found.
import { secrets, waitUntil } from 'base44:runtime';

const FIELDS = 'title,author_name,isbn,publisher,publish_year,first_publish_year,number_of_pages_median,cover_edition_key,subject,edition_key,key,edition_count';

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
  const series = seriesFromTitle(d.title);
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
    // How many editions the catalogue holds — read only to rank search results.
    edition_count: Number(d.edition_count) || 0,
    categories: Array.isArray(d.subject) ? d.subject.slice(0, 5) : [],
    buy_links: buyLinks,
    ...(series ? { series_name: series.series_name, series_position: series.series_position } : {}),
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

// A catalogue title usually prints the series itself — "Iron Flame (The Empyrean, #2)",
// "Onyx Storm (The Empyrean Book 3)" — which costs no lookup to read.
const SERIES_IN_TITLE = /\(([^()]*?(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*\d+[^()]*)\)\s*$/i;
const SERIES_NUMBER = /(?:#|\bbook\b|\bbk\.?\b|\bvol\.?\b|\bvolume\b|\bpart\b)\s*(\d+(?:\.\d+)?)/i;

export function seriesFromTitle(title, subtitle = '') {
  const candidates = [];
  const bracketed = String(title || '').match(SERIES_IN_TITLE);
  if (bracketed) candidates.push(bracketed[1]);
  if (subtitle) candidates.push(String(subtitle));

  for (const text of candidates) {
    const number = text.match(SERIES_NUMBER);
    if (!number) continue;
    const name = text.replace(SERIES_NUMBER, '').replace(/[\s,;:–—-]+$/, '').trim();
    if (name) return { series_name: name, series_position: number[1] };
  }
  return null;
}

// Every edition Open Library holds for one book. A book's series and the formats it
// was published in both live on its editions, so both lookups read them together.
async function openLibraryEditions({ isbn, title, author }) {
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '');
  const workKey = await findWorkKey(clean, title, author);
  if (!workKey) return [];
  const editions = await openLibraryJson(`https://openlibrary.org${workKey}/editions.json?limit=100`);
  return editions?.entries || [];
}

// The series a book belongs to, as { series_name, series_position }.
export async function lookupSeries({ isbn, title, author }) {
  const fromTitle = seriesFromTitle(title);
  if (fromTitle) return fromTitle;

  const tally = new Map();

  for (const edition of await openLibraryEditions({ isbn, title, author })) {
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

// ---------- Formats ----------

// Which formats a book is published in, read from its editions' own physical_format
// values. Those are free text and often in another language — "Poche", "Gebundene
// Ausgabe", "Audio" — so each is matched rather than compared.
const FORMAT_PATTERNS = [
  { format: 'paperback', test: /paperback|softcover|poche|broch|taschenbuch/i },
  { format: 'hardcover', test: /hardcover|hardback|gebunden|reli|cartonn|tapa dura/i },
  { format: 'ebook', test: /e-?book|electronic|epub|digital|electr[oó]nico/i },
  { format: 'kindle', test: /kindle/i },
  { format: 'audiobook', test: /audio|h[oö]rbuch/i },
];

export async function lookupFormats({ isbn, title, author }) {
  const found = new Set();

  for (const edition of await openLibraryEditions({ isbn, title, author })) {
    const value = String(edition?.physical_format || '');
    if (!value) continue;
    for (const { format, test } of FORMAT_PATTERNS) {
      if (test.test(value)) found.add(format);
    }
  }

  return FORMAT_PATTERNS.map((pattern) => pattern.format).filter((format) => found.has(format));
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

// Google is asked in plain words: its field operators (`intitle:`, `inauthor:`, `isbn:`)
// intermittently come back refused, and one that answers with nothing costs the search
// the richer record it was meant to contribute. Plain wording is always answered, its
// title matches rank top anyway, and an ISBN needs no operator to be understood.
function googleQuery(query, type) {
  const text = String(query || '').replace(/["\\]/g, ' ').trim().slice(0, 200);
  return type === 'isbn' ? text.replace(/[^0-9Xx]/g, '') : text;
}

function normalizeGoogleVolume(volume) {
  const info = volume?.volumeInfo || {};
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const identifier = (kind) => identifiers.find((entry) => entry?.type === kind)?.identifier || '';
  const isbn = (identifier('ISBN_13') || identifier('ISBN_10')).replace(/[^0-9Xx]/g, '');
  const title = String(info.title || '').trim();
  const author = Array.isArray(info.authors) ? info.authors.join(', ') : String(info.authors || '');
  const thumbnail = String(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '');
  const series = seriesFromTitle(title, info.subtitle);

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
    ...(series ? { series_name: series.series_name, series_position: series.series_position } : {}),
  };
}

// Google's own catalogue answers a request it would serve happily a moment later with a
// transient 5xx often enough to matter, and a search that loses that call falls back to
// Open Library's thinner record while the richer one was one attempt away. So a failed
// call is asked again a couple of times. A refusal (4xx) is not retried — the request
// itself is what it objected to — and the retries stop once they have taken long enough
// that a reader would be waiting on them rather than on the search.
const GOOGLE_RETRY_DELAYS_MS = [250, 700];
const GOOGLE_RETRY_DEADLINE_MS = 9000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchGoogleBooks(query, type) {
  const key = googleBooksKey();
  // No `country` filter: Google answers a region it cannot match with an empty catalogue,
  // and a search wants the widest list of matches, not the ones sold in one country.
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(googleQuery(query, type))}`
    + `&maxResults=20&printType=books${key ? `&key=${encodeURIComponent(key)}` : ''}`;

  const started = Date.now();
  let failure = null;

  for (let attempt = 0; attempt <= GOOGLE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt) {
      if (Date.now() - started > GOOGLE_RETRY_DEADLINE_MS) break;
      await wait(GOOGLE_RETRY_DELAYS_MS[attempt - 1]);
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        return (data.items || []).map(normalizeGoogleVolume).filter((book) => book.title);
      }

      const error = new Error('Book lookup failed');
      error.status = res.status;
      if (res.status < 500) throw error;
      failure = error;
    } catch (error) {
      if (error?.status && error.status < 500) throw error;
      failure = error;
    }
  }

  throw failure;
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
  // v2: a stored answer now carries each book's series, so answers kept under the
  // older key are not handed back.
  return `v2:${type}:${text.slice(0, 200)}`;
}

async function readCacheRecord(db, key) {
  try {
    const { items } = await db.asServiceRole.entities.BookSearchCache
      .filter({ cache_key: key }, { sort: '-created_date', limit: 1 });
    const hit = items[0];
    if (!hit) return null;

    const ageDays = (Date.now() - new Date(hit.created_date).getTime()) / 86400000;
    return ageDays > CACHE_DAYS ? null : hit;
  } catch {
    return null; // A cache that cannot be read is a miss, never a failed search.
  }
}

async function readCache(db, key) {
  const hit = await readCacheRecord(db, key);
  return Array.isArray(hit?.books) && hit.books.length ? hit.books : null;
}

// The formats a book is published in are kept the same way, under their own key, so a
// book that has been looked at once is never asked about twice.
export async function readCachedFormats(db, key) {
  const hit = await readCacheRecord(db, key);
  return Array.isArray(hit?.formats) ? hit.formats : null;
}

export async function writeCachedFormats(db, key, formats) {
  try {
    await db.asServiceRole.entities.BookSearchCache.create({ cache_key: key, formats });
  } catch {
    // An answer that was found is still an answer if it cannot be kept.
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

// Study guides, annotated editions and translated or boxed versions fill the catalogues
// and would sit exactly where the reader looks for the book itself, so they are demoted
// — unless the search itself asked for one.
const NOT_THE_BOOK = /\b(?:summary|summarized|summarised|study guide|analysis|key takeaways|workbook|companion|quicklet|cliff ?notes|sparknotes|edition|translated|translation|abridged|unabridged|box ?set|collection set)\b/i;

// How well a result answers what was typed: a title word counts for more than an
// author word, and an exact title wins outright, so the real book leads the list
// even when a loose retry brought back dozens of near-misses.
function relevance(book, query) {
  const title = cleanText(book.title);
  const author = cleanText(book.author);
  const wanted = cleanText(query);
  const typed = String(query || '');

  let score = 0;
  for (const word of significantWords(query)) {
    if (title.includes(word)) score += 3;
    else if (author.includes(word)) score += 2;
  }

  // The book whose title is the opening of what was typed — "Iron Flame" for "Iron Flame
  // (The Empyrean, #2)" — is the one being asked for, ahead of anything that merely
  // mentions those words, however many of them it happens to contain.
  if (wanted && title === wanted) score += 12;
  else if (wanted && wanted.startsWith(`${title} `)) score += 10;
  else if (wanted && title.startsWith(wanted)) score += 6;

  if (!NOT_THE_BOOK.test(typed) && NOT_THE_BOOK.test(`${book.title || ''} ${book.author || ''}`)) score -= 8;
  return score;
}

// An answer is trusted when some result carries the whole of what was typed across its
// title and author. One that only found near-misses — the summaries of a book, or a set
// that merely includes it — earns a retry under the tidier wording first.
function isConfident(books, query) {
  const isbn = String(query || '').replace(/[-\s]/g, '').toUpperCase();
  if (/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
    return books.some((book) => String(book.isbn || '').replace(/[-\s]/g, '').toUpperCase() === isbn);
  }
  const wanted = significantWords(query);
  if (!wanted.length) return books.length > 0;
  return books.some((book) => {
    const text = `${cleanText(book.title)} ${cleanText(book.author)}`;
    return wanted.every((word) => text.includes(word));
  });
}

// Every answer as one list: a book is kept once — the first record of it, which is
// Google's richer one when both catalogues hold it — and the list is then ordered so
// the book being asked for leads. Two different books can share a title, and there the
// one the catalogue holds in most editions wins: the well-known book of that name.
function mergeAnswers(lists, query, limit = 24) {
  const seen = new Set();
  const unique = [];

  for (const book of lists.flat()) {
    if (!book?.title) continue;
    const title = cleanText(book.title);
    if (!title) continue;

    const key = `${title}|${cleanText(book.author).split(' ')[0] || ''}`;
    const isbnKey = book.isbn ? `isbn:${book.isbn}` : '';
    if (seen.has(key) || (isbnKey && seen.has(isbnKey))) continue;
    seen.add(key);
    if (isbnKey) seen.add(isbnKey);
    unique.push(book);
  }

  // A catalogue sometimes lists a title with no author at all — a thin record of a book the
  // other catalogue holds properly — so such a record is dropped when the same title came
  // back with an author to go with it.
  const titled = new Set(unique.filter((book) => cleanText(book.author)).map((book) => cleanText(book.title)));
  const books = unique.filter((book) => cleanText(book.author) || !titled.has(cleanText(book.title)));

  return books
    .map((book, index) => ({ book, index, score: relevance(book, query) }))
    // The record that carries the book's own description leads: several books can share a
    // title, and the described record is the fuller answer, while Open Library's count of
    // editions settles the rest. That count cannot lead on its own, because Google's
    // records do not carry one and a one-edition stub would then outrank the real book.
    .sort((a, b) => (b.score - a.score)
      || ((b.book.description ? 1 : 0) - (a.book.description ? 1 : 0))
      || ((b.book.edition_count || 0) - (a.book.edition_count || 0))
      || (a.index - b.index))
    .slice(0, limit)
    .map((entry) => entry.book);
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
  const isbn = String(query || '').replace(/[-\s]/g, '');
  if (type === 'all' && /^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) {
    query = isbn;
    type = 'isbn';
  }
  const key = cacheKey(query, type);
  const cached = await readCache(db, key);
  if (cached) return cached;

  const started = Date.now();
  const found = [];
  let answered = false;
  let lastError = null;

  // Retry tidier wording only when the first answer did not identify the book.
  for (const variant of queryVariants(query, type)) {
    if (Date.now() - started > SEARCH_BUDGET_MS) break;
    try {
      const books = await searchAttempt(variant, type);
      answered = true;
      found.push(...books);
      if (isConfident(books, query)) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!answered && lastError) throw lastError;

  const books = mergeAnswers(found, query);
  // Near-misses are handed back but not kept, so a later search can still do better.
  if (books.length && isConfident(books, query)) waitUntil(writeCache(db, key, books));
  return books;
}