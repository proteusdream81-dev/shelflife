// Shared book catalogue access, used by searchBooks, identifyBook, bookSeries and
// authorReleases. A search merges Google Books and Open Library, and retries with a
// tidier wording, so a book held by only one catalogue is still found. A search that
// still comes back empty makes one last stop at Project Gutenberg, which is where the
// public-domain classics the other catalogues no longer carry are kept.
import { secrets, waitUntil } from 'base44:runtime';

const FIELDS = 'title,author_name,isbn,publisher,publish_year,first_publish_year,number_of_pages_median,cover_edition_key,subject,edition_key,key,edition_count';

// Amazon matches a title and author far more reliably than an ISBN — a book has
// several, and theirs is often a different edition — so its search uses those
// alone, with a lookup by ISBN offered alongside as the fallback.
function buildBuyLinks(isbn, title, author) {
  const amazonQuery = [title, author].filter(Boolean).join(' ').trim();
  const amazonTerm = amazonQuery || isbn;

  const links = [];
  // One Amazon link per book. It is pointed at the reader's own Amazon storefront when it
  // is shown, so the store is never listed twice, and the search falls back to the ISBN
  // only for a book whose title the catalogue did not give us.
  if (amazonTerm) {
    links.push({ name: 'Amazon', url: `https://www.amazon.com.au/s?k=${encodeURIComponent(amazonTerm)}` });
  }
  if (isbn) {
    links.push({ name: 'Bookfinder', url: `https://www.bookfinder.com/search/?isbn=${isbn}&mode=isbn&st=sr&ac=qr` });
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
  const res = await fetchWithRetry('openlibrary', url, { headers: { Accept: 'application/json' } }, { timeoutMs: 10000 });
  const data = await res.json().catch(() => null);
  return (Array.isArray(data?.docs) ? data.docs : []).map(normalizeDoc).filter((b) => b && b.title);
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every catalogue below is reached through this one call, so a dropped connection, a timeout
// or a momentary 5xx is asked again after a growing pause rather than turning a search into
// "no books found" — a catalogue that would serve the same request a moment later almost
// always does. A refusal (4xx) is not retried: the request itself is what it objected to, and
// asking again only makes the reader wait longer for the same answer. Each attempt gets a
// fresh timeout, and both the number of attempts and the total waiting are bounded, because a
// reader is waiting on the answer.
const RETRY_DELAYS_MS = [300, 900];
const RETRY_DEADLINE_MS = 9000;

async function fetchWithRetry(label, url, init = {}, options = {}) {
  const delays = options.delays || RETRY_DELAYS_MS;
  const attempts = options.attempts === undefined ? delays.length : options.attempts;
  const deadline = options.deadlineMs || RETRY_DEADLINE_MS;
  const timeout = options.timeoutMs || 10000;
  const started = Date.now();
  let failure = null;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt) {
      if (Date.now() - started > deadline) break;
      await wait(delays[attempt - 1] || delays[delays.length - 1]);
    }

    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;

      const error = new Error(`${label} answered ${res.status}`);
      error.status = res.status;
      const transient = res.status >= 500 || res.status === 429;
      if (!transient) throw error;
      failure = error;
    } catch (error) {
      const status = Number(error?.status) || 0;
      if (status && status < 500 && status !== 429) throw error;
      failure = error;
    }
  }

  throw failure || new Error(`${label} could not be reached`);
}

async function searchGoogleBooks(query, type) {
  const key = googleBooksKey();
  // No `country` filter: Google answers a region it cannot match with an empty catalogue,
  // and a search wants the widest list of matches, not the ones sold in one country.
  const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(googleQuery(query, type))}`
    + `&maxResults=20&printType=books${key ? `&key=${encodeURIComponent(key)}` : ''}`;

  const res = await fetchWithRetry('google', url, {}, { timeoutMs: 10000 });
  const data = await res.json().catch(() => null);
  return (Array.isArray(data?.items) ? data.items : [])
    .map(normalizeGoogleVolume)
    .filter((book) => book.title);
}

// ---------- Hardcover (third catalogue, supplementary) ----------

// Hardcover is community-maintained, so it is asked for what the publisher's own record does
// not carry: the average rating its own readers gave a book, its cover art, and the details
// of the editions it was printed in. Nothing here leads a search — a record Google or Open
// Library already gave is the one kept, and Hardcover only fills in what that record left
// blank.
const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';

// The source is supplementary, so it is given less time than the primaries: an answer it is
// slow to give is worth less than the search a reader is already waiting on.
const HARDCOVER_TIMEOUT_MS = 4000;

// A token from hardcover.app/account/api is optional, and `secrets.get` throws when nothing
// is saved, so it is read defensively. With no token the source is skipped in silence — no
// call made, nothing reported as failed — and the chain works exactly as it did before.
function hardcoverToken() {
  try {
    return String(secrets.get('HARDCOVER_API_KEY') || '').trim().replace(/^Bearer\s+/i, '');
  } catch {
    return '';
  }
}

// GraphQL answers 200 with an `errors` list for a query it refused, so the status and the
// body are both read before an answer is trusted. Returns null only when there is no token
// to ask with, which is not a failure.
async function hardcoverRequest(query, variables) {
  const token = hardcoverToken();
  if (!token) return null;

  // One retry only: this source is supplementary, so a slow answer from it is worth less than
  // the search a reader is already waiting on.
  const res = await fetchWithRetry('hardcover', HARDCOVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  }, { timeoutMs: HARDCOVER_TIMEOUT_MS, delays: [300], attempts: 1, deadlineMs: HARDCOVER_TIMEOUT_MS });

  const payload = await res.json().catch(() => null);
  if (!payload?.data || payload?.errors?.length) {
    const error = new Error('Book lookup failed');
    error.status = 502;
    throw error;
  }

  return payload.data;
}

// Hardcover holds the work once and its printings beneath it: the rating, cover and summary
// belong to the book, while the ISBN, publisher, page count and release date are the
// edition's own.
const HARDCOVER_BOOK_FIELDS = `
  id
  title
  subtitle
  description
  pages
  release_date
  rating
  ratings_count
  contributions { author { name } }
  image { url }
`;

const HARDCOVER_EDITION_FIELDS = `
  isbn_13
  isbn_10
  pages
  release_date
  publisher { name }
  image { url }
`;

// The words a match is built from: punctuation that would break a pattern is dropped, and
// only the first few are used, so a long typed title cannot turn into a long filter.
const hardcoverWords = (value) => String(value || '')
  .replace(/["\\%_]/g, ' ')
  .split(/\s+/)
  .map((word) => word.trim())
  .filter((word) => word.length > 1)
  .slice(0, 5);

const hardcoverTitleOrAuthor = (word) => ({
  _or: [
    { title: { _ilike: `%${word}%` } },
    { contributions: { author: { name: { _ilike: `%${word}%` } } } },
  ],
});

// One record in this file's shape, so a Hardcover answer merges with the others unchanged.
function normalizeHardcoverBook(book, edition) {
  const credits = Array.isArray(book?.contributions) ? book.contributions : [];
  const authors = credits.map((credit) => credit?.author?.name).filter(Boolean);
  const title = String(book?.title || '').trim();
  const author = [...new Set(authors)].join(', ');
  const isbn = String(edition?.isbn_13 || edition?.isbn_10 || '').replace(/[^0-9Xx]/g, '');
  const rating = Number(book?.rating) || 0;
  const series = seriesFromTitle(title, book?.subtitle);

  return {
    // Google's own id stays in Google's field: this record has no volume id, and a cover
    // link built from the wrong id is one that never loads.
    google_books_id: '',
    hardcover_id: String(book?.id || ''),
    title,
    author,
    isbn,
    cover_url: String(book?.image?.url || edition?.image?.url || ''),
    description: String(book?.description || '').trim(),
    publisher: String(edition?.publisher?.name || ''),
    published_date: String(edition?.release_date || book?.release_date || ''),
    page_count: Number(book?.pages || edition?.pages) || 0,
    // Hardcover's readers' average, kept apart from the reader's own rating and always shown
    // as Hardcover's. No edition count is claimed here: this source is not made to rank.
    community_rating: rating > 0 ? Math.round(rating * 10) / 10 : 0,
    community_ratings_count: Number(book?.ratings_count) || 0,
    categories: [],
    buy_links: buildBuyLinks(isbn, title, author),
    ...(series ? { series_name: series.series_name, series_position: series.series_position } : {}),
  };
}

// The books this source can answer a search with. An ISBN names one edition exactly, so it
// is looked up among the editions; anything else is matched on the words typed, each of
// which has to appear in the title — or, for a title-and-author search, in the title or in
// a credited author's name. Without a token this returns nothing at all rather than failing,
// so a search is never reported as partly failed over a source that was not asked.
async function searchHardcover(query, type) {
  if (!hardcoverToken()) return [];

  if (type === 'isbn') {
    const digits = String(query || '').replace(/[^0-9Xx]/g, '');
    if (!digits) return [];

    const data = await hardcoverRequest(`query HardcoverIsbn($isbn: String!) {
      editions(
        where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }
        limit: 3
      ) {
        ${HARDCOVER_EDITION_FIELDS}
        book { ${HARDCOVER_BOOK_FIELDS} }
      }
    }`, { isbn: digits });

    return (data?.editions || [])
      .map((edition) => normalizeHardcoverBook(edition?.book, edition))
      .filter((book) => book.title);
  }

  const words = hardcoverWords(query);
  if (!words.length) return [];

  const match = (word) => {
    if (type === 'author') return { contributions: { author: { name: { _ilike: `%${word}%` } } } };
    if (type === 'title') return { title: { _ilike: `%${word}%` } };
    return hardcoverTitleOrAuthor(word);
  };

  const data = await hardcoverRequest(`query HardcoverSearch($filter: books_bool_exp!) {
    books(where: $filter, order_by: { users_count: desc }, limit: 12) {
      ${HARDCOVER_BOOK_FIELDS}
    }
  }`, { filter: { _and: words.map(match) } });

  return (data?.books || []).map((book) => normalizeHardcoverBook(book, null)).filter((book) => book.title);
}

// The cover art this source holds for a book: the one on the work itself, then the covers of
// its printings — including the ones the other catalogues do not carry at all. It is
// supplementary, so an answer that is slow, refused or mis-shaped adds no covers rather than
// failing the picker it was asked for.
async function hardcoverCovers({ isbn, title, author }) {
  if (!hardcoverToken()) return [];

  const coverFields = 'image { url } editions { image { url } }';
  const urls = [];

  try {
    const clean = String(isbn || '').replace(/[^0-9Xx]/g, '');

    if (clean) {
      const data = await hardcoverRequest(`query HardcoverCoversByIsbn($isbn: String!) {
        editions(
          where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }
          limit: 1
        ) {
          book { ${coverFields} }
        }
      }`, { isbn: clean });

      for (const edition of data?.editions || []) {
        urls.push(edition?.book?.image?.url);
        for (const child of edition?.book?.editions || []) urls.push(child?.image?.url);
      }

      return urls.filter(Boolean);
    }

    const words = hardcoverWords([title, author].filter(Boolean).join(' '));
    if (!words.length) return [];

    const data = await hardcoverRequest(`query HardcoverCoversByTitle($filter: books_bool_exp!) {
      books(where: $filter, order_by: { users_count: desc }, limit: 1) {
        ${coverFields}
      }
    }`, { filter: { _and: words.map(hardcoverTitleOrAuthor) } });

    for (const book of data?.books || []) {
      urls.push(book?.image?.url);
      for (const edition of book?.editions || []) urls.push(edition?.image?.url);
    }

    return urls.filter(Boolean);
  } catch {
    return [];
  }
}

// ---------- Project Gutenberg (fourth catalogue, asked only as a last resort) ----------

// Gutendex is the free JSON index over Project Gutenberg's public-domain library — the one
// source here that holds the books nobody prints or sells any more. It needs no key, and no
// particular reader is identified by anything asked of it.
const GUTENDEX_URL = 'https://gutendex.com/books';

// Because it is the last resort, it is asked only after the reader has already waited on every
// catalogue above, so it is given less time than they are: an answer that is slow to come is
// worth less than the search a reader is waiting on.
const GUTENDEX_TIMEOUT_MS = 4000;

// One Gutenberg record in this file's shape. Gutenberg is a library of texts rather than a
// shop: it carries no ISBN, no publisher, no page count and often no cover, so those are left
// empty — and a record without a cover is drawn on the reader's shelf exactly as any other book
// still waiting for one, so the grid stays uniform.
function normalizeGutenbergBook(entry) {
  const flatten = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const authors = (Array.isArray(entry?.authors) ? entry.authors : [])
    .map((author) => flatten(author?.name))
    .filter(Boolean);
  const formats = entry?.formats || {};
  const summaries = (Array.isArray(entry?.summaries) ? entry.summaries : []).map(flatten).filter(Boolean);
  const subjects = (Array.isArray(entry?.subjects) ? entry.subjects : []).map(flatten).filter(Boolean);
  const title = flatten(entry?.title);
  const series = seriesFromTitle(title);

  // The link a reader can actually follow: Gutenberg's own reading copy, its HTML first and the
  // EPUB as the alternative, and the book's page there when it offered neither.
  const readUrl = flatten(formats['text/html'] || formats['application/epub+zip'])
    || (entry?.id ? `https://www.gutenberg.org/ebooks/${entry.id}` : '');

  return {
    // No id in another catalogue's naming is claimed here: Google's field and Hardcover's each
    // build their own cover link out of the value, and one filled from the wrong source is a
    // link that never loads.
    google_books_id: '',
    title,
    author: authors.join(', '),
    isbn: '',
    cover_url: flatten(formats['image/jpeg']),
    description: summaries.length ? summaries.join(' ') : subjects.slice(0, 3).join('; '),
    publisher: '',
    published_date: '',
    page_count: 0,
    categories: subjects.slice(0, 5),
    buy_links: readUrl ? [{ name: 'Read free (Gutenberg)', url: readUrl }] : [],
    ...(series ? { series_name: series.series_name, series_position: series.series_position } : {}),
  };
}

// What this source can answer a search with. An ISBN names a shop's printing, and this library
// has none, so an ISBN search skips it rather than answering with a text that is not the book
// asked for. A lookup that is refused or times out is thrown, and the caller decides what to
// make of it: this source sits behind a bot check that turns the app's own servers away, so a
// search that asked and got nothing back is the ordinary case rather than a fault.
async function searchGutenberg(query, type) {
  if (type === 'isbn') return [];

  const text = String(query || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return [];

  const res = await fetchWithRetry(
    'gutendex',
    `${GUTENDEX_URL}?search=${encodeURIComponent(text)}`,
    { headers: { Accept: 'application/json' } },
    { timeoutMs: GUTENDEX_TIMEOUT_MS, delays: [300], attempts: 1, deadlineMs: GUTENDEX_TIMEOUT_MS },
  );

  const data = await res.json().catch(() => null);
  return (Array.isArray(data?.results) ? data.results : [])
    .map(normalizeGutenbergBook)
    .filter((book) => book.title);
}

// ---------- Trove (the National Library of Australia, asked only when the rest came up short) ----------

// Trove is where the Australian books live: the titles published here, and the local authors the
// international shops and catalogues carry thinly or not at all. It is asked last and never
// trusted to lead a search, because its records are library records rather than a publisher's.
const TROVE_URL = 'https://api.trove.nla.gov.au/v3/result';

// It sits at the end of the chain, so its answer is worth less than the search a reader is
// already waiting on.
const TROVE_TIMEOUT_MS = 3500;

// A Trove API key is optional, and `secrets.get` throws when nothing is saved, so it is read
// defensively. With no key the source is simply not asked.
function troveKey() {
  try {
    return String(secrets.get('TROVE_API_KEY') || '').trim();
  } catch {
    return '';
  }
}

const asList = (value) => (Array.isArray(value) ? value : [value])
  .map((entry) => String(entry ?? '').replace(/\s+/g, ' ').trim())
  .filter(Boolean);

// A Trove work's title carries the statement of responsibility printed after a slash
// ("Tangled : the essential guide to Rapunzel's world / Barbara Bazaldua"), which is the author's
// name rather than part of the title.
function troveTitle(raw) {
  const text = asList(raw).join(' ');
  return text.split(/\s+\/\s+/)[0].replace(/[\s:;,]+$/, '').trim();
}

// Trove holds a work with the versions it was printed in beneath it, so the title, author and
// subjects are the work's while the ISBN, publisher and page count belong to a version.
function normalizeTroveWork(work) {
  const versions = (Array.isArray(work?.version) ? work.version : [work?.version]).filter(Boolean);
  const fromVersion = (pick) => {
    for (const version of versions) {
      const value = pick(version);
      const seen = Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? '').trim());
      if (seen) return value;
    }
    return '';
  };

  const title = troveTitle(work?.title);
  if (!title) return null;

  const author = asList(work?.contributor).join(', ');
  const isbn = [
    ...asList(fromVersion((v) => v?.isbn)),
    ...asList(fromVersion((v) => v?.isbn13)),
  ]
    .map((value) => value.replace(/[^0-9Xx]/g, ''))
    .find((value) => value.length === 10 || value.length === 13) || '';
  const publisher = asList(fromVersion((v) => v?.publisher)).join(', ');
  const issued = String(work?.issued || fromVersion((v) => v?.issued) || '').trim();
  const pages = Number(String(fromVersion((v) => v?.pages) || '').replace(/[^0-9]/g, '')) || 0;
  const subjects = asList(work?.subject).slice(0, 5);
  const note = asList(work?.snippet || work?.abstract).join(' ').slice(0, 600);
  const troveUrl = String(work?.troveUrl || (work?.id ? `https://trove.nla.gov.au/work/${work.id}` : ''));
  const series = seriesFromTitle(title);

  return {
    // Trove's own record is not another catalogue's id, and a cover link built from one would
    // never load: this source contributes no cover art, and a result is never held back for it.
    google_books_id: '',
    title,
    author,
    isbn,
    cover_url: '',
    description: note,
    publisher,
    published_date: issued,
    page_count: pages,
    categories: subjects,
    buy_links: [
      ...buildBuyLinks(isbn, title, author),
      ...(troveUrl ? [{ name: 'Trove', url: troveUrl }] : []),
    ],
    ...(series ? { series_name: series.series_name, series_position: series.series_position } : {}),
  };
}

// What this source can answer a search with, in the same shape as every other catalogue's
// records. It is asked with the words as typed, since its free-text search reads a title, an
// author and a publisher the same way.
async function searchTrove(query, type) {
  const key = troveKey();
  if (!key) return [];

  const text = String(query || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return [];

  const terms = type === 'isbn' ? text.replace(/[^0-9Xx]/g, '') : text;
  if (!terms) return [];

  const url = `${TROVE_URL}?category=book&include=book&encoding=json&n=20&q=${encodeURIComponent(terms)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-API-KEY': key },
    signal: AbortSignal.timeout(TROVE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`trove answered ${res.status}`);

  const data = await res.json().catch(() => null);
  const categories = Array.isArray(data?.category) ? data.category : [];
  const books = categories.find((entry) => String(entry?.code || '') === 'book') || categories[0];
  const works = Array.isArray(books?.records?.work) ? books.records.work : [];
  return works.map(normalizeTroveWork).filter(Boolean);
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
  // v3: an answer is now kept only when every catalogue answered it, and a search the reader
  // runs again takes the stored answer out of the way first. Answers written under the older
  // key followed neither rule, and one of those sitting in front of a fuller result is
  // exactly what a stale answer masking a fresh one looks like.
  return `v3:${type}:${text.slice(0, 200)}`;
}

async function readCacheRecord(db, key) {
  try {
    const { items } = await db.asServiceRole.entities.BookSearchCache
      .filter({ cache_key: key }, { sort: '-created_date', limit: 1 });
    const hit = items[0];
    if (!hit) return null;

    const ageDays = (Date.now() - new Date(hit.created_date).getTime()) / 86400000;
    if (ageDays <= CACHE_DAYS) return hit;

    // An answer that has aged out is removed as it is found, so a catalogue record that
    // has since changed is never served from a stale copy left lying in the table.
    await db.asServiceRole.entities.BookSearchCache.deleteMany({ cache_key: key });
    return null;
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
// What a supplementary catalogue may add to a record another catalogue already gave: only
// what that record left empty, so nothing a richer source said is ever overwritten.
const ENRICHABLE_FIELDS = [
  'cover_url', 'description', 'publisher', 'published_date', 'page_count',
  'hardcover_id', 'community_rating', 'community_ratings_count',
];

const saysSomething = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null || value === '') return false;
  return typeof value !== 'number' || value > 0;
};

function fillGaps(kept, incoming) {
  for (const field of ENRICHABLE_FIELDS) {
    if (saysSomething(kept[field]) || !saysSomething(incoming[field])) continue;
    kept[field] = incoming[field];
  }
}

function mergeAnswers(lists, query, limit = 24) {
  const seen = new Set();
  const keptByKey = new Map();
  const unique = [];

  for (const book of lists.flat()) {
    if (!book?.title) continue;
    const title = cleanText(book.title);
    if (!title) continue;

    const key = `${title}|${cleanText(book.author).split(' ')[0] || ''}`;
    const isbnKey = book.isbn ? `isbn:${book.isbn}` : '';

    if (seen.has(key) || (isbnKey && seen.has(isbnKey))) {
      // A second record of the same book adds to the one already kept — Hardcover's cover or
      // rating filling a gap Google left, say — rather than being discarded with it.
      const kept = keptByKey.get(key) || (isbnKey ? keptByKey.get(isbnKey) : null);
      if (kept) fillGaps(kept, book);
      continue;
    }

    seen.add(key);
    if (isbnKey) seen.add(isbnKey);
    keptByKey.set(key, book);
    if (isbnKey) keptByKey.set(isbnKey, book);
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

// The catalogues a search draws on, in the order they are asked: Google Books as the primary
// record, because it carries the publisher's own title, description, subjects and page count
// and is not publicly editable, then Open Library as the backup that needs no key at all.
// A third catalogue is one more entry here — its name, and a search function returning books
// in this file's shape — and nothing else in a search has to change. An entry that is
// switched off costs a search nothing: it is reported as missing from the answer rather than
// failing the search, which is what the reader is shown as a thinner result. Project Gutenberg
// is deliberately not an entry here: it is a last resort rather than a source asked beside the
// others, and searchAttempt turns to it by hand once they have all come back empty.
const CATALOGS = [
  { name: 'google', enabled: true, search: searchGoogleBooks },
  { name: 'openlibrary', enabled: true, search: searchOpenLibrary },
  // Hardcover is the third source, asked beside the two above for the ratings, cover art and
  // edition details they do not carry. It answers only once its token is saved; with none it
  // reports itself found-nothing rather than failed, so a search is never described to the
  // reader as partly failed over a source that was simply never asked.
  { name: 'hardcover', enabled: true, search: searchHardcover },
];

// One attempt: every catalogue is asked at once, so a book held by only one of them still
// surfaces. A source that fails is reported rather than thrown: one catalogue being down is
// not a search that found nothing, it is a thinner answer, and the reader is told so.
// `lastResort` adds Project Gutenberg, which is asked only when these catalogues have come back
// with nothing at all — the classics it holds are the ones no shop and no catalogue above lists,
// and asking it on every search would spend a lookup nobody needed.
async function searchAttempt(variant, type, lastResort = false) {
  const asked = CATALOGS.filter((catalog) => catalog.enabled);
  // Each catalogue is timed and named in the log, so an answer that came back thin can be
  // traced to the source that failed to give it rather than guessed at.
  const settled = await Promise.allSettled(asked.map(async (catalog) => {
    const started = Date.now();
    try {
      const list = await catalog.search(variant, type);
      console.log(`[bookSearch] ${catalog.name} "${variant}" -> ${list.length} book(s) in ${Date.now() - started}ms`);
      return { name: catalog.name, books: list };
    } catch (error) {
      console.log(`[bookSearch] ${catalog.name} "${variant}" failed in ${Date.now() - started}ms: `
        + `${error?.status || 'no status'} ${error?.message || error}`);
      throw error;
    }
  }));

  const books = [];
  const failed = [];
  const sources = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      failed.push(asked[index].name);
      return;
    }
    sources.push({ name: result.value.name, count: result.value.books.length });
    books.push(...result.value.books);
  });

  if (failed.length === asked.length) {
    const rejection = settled.find((result) => result.status === 'rejected');
    throw (rejection && rejection.status === 'rejected' ? rejection.reason : null)
      || new Error('Every catalogue failed');
  }

  // Nothing found anywhere above, so the library of last resort is asked once. Anything it does
  // hold is merged in like any other source's record.
  if (!books.length && lastResort) {
    try {
      books.push(...await searchGutenberg(variant, type));
    } catch {
      // Refused or timed out: passed over in silence. This source sits behind a bot check that
      // turns the app's own servers away, so a lookup that doesn't come back is its ordinary
      // state rather than a thinner answer to report — a search that found nothing still reads
      // as nothing found, exactly as it did before this source was asked at all.
    }
  }

  return { books, failed, sources };
}

// A reader waits on this call, so the retries share one budget: a catalogue that
// hangs cannot turn three attempts into half a minute of waiting.
const SEARCH_BUDGET_MS = 18000;

// The catalogues together: Google Books as the primary record, answered on the app's own
// free quota when a key is saved and on Google's shared one when it isn't, plus Open
// Library, which needs no key at all. The typed query is asked first; an answer that
// doesn't carry the book being asked for earns a retry under a tidier wording, and
// everything found along the way is ranked together. A trustworthy answer is kept, so a
// search that has been run before is served from the cache and costs no upstream lookup. A
// search no catalogue above could answer makes one last stop at Project Gutenberg.
// The answer says whether a catalogue was missing from it, so an empty or thin list can be
// reported to the reader as a lookup that partly failed rather than as "no books found".
export async function searchBooks(query, type, db, options = {}) {
  const isbn = String(query || '').replace(/[-\s]/g, '');
  if (type === 'all' && /^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) {
    query = isbn;
    type = 'isbn';
  }
  const key = cacheKey(query, type);
  // A search the reader asked to run again clears the stored answer before anyone is asked,
  // so what the catalogues say this time is what is kept, including nothing at all, and a
  // stale entry can never be handed back in its place.
  if (options.fresh) {
    await clearCachedSearch(query, type, db);
  } else {
    const cached = await readCache(db, key);
    if (cached) {
      console.log(`[bookSearch] "${query}" (${type}) served ${cached.length} book(s) from the cache`);
      return { books: cached, partial: false };
    }
  }

  const started = Date.now();
  const found = [];
  const missing = new Set();
  const satisfied = new Set();
  let answered = false;
  let lastError = null;

  // Retry tidier wording only when the first answer did not identify the book. Project Gutenberg
  // waits for the last wording: a source of last resort is worth one lookup per search, not one
  // per retry, and the loosest wording is the one a classic is most likely to answer.
  const variants = queryVariants(query, type);
  for (let index = 0; index < variants.length; index += 1) {
    if (Date.now() - started > SEARCH_BUDGET_MS) break;
    try {
      const { books, failed, sources } = await searchAttempt(variants[index], type, index === variants.length - 1);
      answered = true;
      failed.forEach((name) => missing.add(name));
      // Which catalogue actually answered, so a thin result can be read against the source
      // that gave it instead of being blamed on the search as a whole.
      sources.filter((source) => source.count > 0).forEach((source) => satisfied.add(source.name));
      found.push(...books);
      if (isConfident(books, query)) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!answered && lastError) throw lastError;

  // Trove is asked last, and only when the catalogues above came up short: it is where the
  // Australian titles and local authors the others carry thinly are held, which makes it the one
  // source that can answer a search none of them could. It is a supplement, so a key that isn't
  // saved, a refusal or a timeout simply contributes nothing — it is never reported as a missing
  // source, and it never turns a search that would have answered into a slower one.
  const confident = found.length > 0 && isConfident(found, query);
  if (troveKey() && !confident) {
    try {
      const list = await searchTrove(query, type);
      if (list.length) console.log(`[bookSearch] trove "${query}" -> ${list.length} book(s)`);
      found.push(...list);
    } catch (error) {
      console.log(`[bookSearch] trove skipped: ${error?.message || error}`);
    }
  }

  const books = mergeAnswers(found, query);
  console.log(`[bookSearch] "${query}" (${type}) -> ${books.length} book(s) from `
    + `${[...satisfied].join(', ') || 'no source'} in ${Date.now() - started}ms`
    + `${missing.size ? `; unavailable: ${[...missing].join(', ')}` : ''}`);
  // Only a confident answer with every catalogue behind it is kept. A near-miss is handed
  // back but not stored, so a later search can still do better, and a thin answer from a
  // search that ran while a catalogue was down is never kept in place of the fuller one.
  if (books.length && missing.size === 0 && isConfident(books, query)) {
    waitUntil(writeCache(db, key, books));
  }
  return { books, partial: missing.size > 0 };
}

// A search run again replaces whatever was stored for that wording, so a reader who is sure
// a book exists can clear a stale answer out of the way rather than wait for it to age out.
export async function clearCachedSearch(query, type, db) {
  try {
    await db.asServiceRole.entities.BookSearchCache.deleteMany({ cache_key: cacheKey(query, type) });
    return true;
  } catch {
    return false;
  }
}

// An ISBN is a shape — ten characters ending in a digit or X, or thirteen digits — and only
// a value of that shape is asked for as one. Anything else is not an ISBN: a Kindle export
// keeps its ASIN in the identifier column, and asking the catalogues for that as an ISBN was
// what left imported Kindle books without a cover or any other detail.
const ISBN_SHAPE = /^(?:\d{9}[\dXx]|\d{13})$/;

// The one best record for a book a reader already owns — what an import uses to fill in the
// metadata and cover that a list of titles arrived without. An ISBN is asked first, because
// it names one edition exactly; a book without one — a Kindle edition, whose ASIN no
// catalogue here answers to — is looked up by its title and author instead.
export async function lookupBook({ title, author, isbn, asin }, db) {
  const digits = String(isbn || '').replace(/[^0-9Xx]/g, '');
  if (ISBN_SHAPE.test(digits)) {
    const byIsbn = await searchBooks(digits, 'isbn', db);
    if (byIsbn.books.length) return { book: byIsbn.books[0], source: 'isbn' };
  }

  const query = [title, author].filter(Boolean).join(' ').trim();
  if (!query) return { book: null, source: '' };

  const byTitle = await searchBooks(query, 'all', db);
  const book = byTitle.books[0] || null;
  console.log(`[bookSearch] enrichment "${query}" -> ${book ? `matched (${book.title})` : 'no match'}`
    + `${byTitle.partial ? ' on a partial answer' : ''}`);
  // An ASIN in the record says this is a Kindle edition, which is what the caller sets the
  // book's format from when the reader's own export did not name one.
  const source = book ? (asin ? 'asin-title-author' : 'title-author') : '';
  return { book, source };
}

// ---------- Covers ----------

const MAX_COVERS = 12;

const googleCover = (id, zoom = 3) => (id
  ? `https://books.google.com/books/content?id=${encodeURIComponent(id)}&printsec=frontcover&img=1&zoom=${zoom}&source=gbs_api`
  : '');

// The covers the catalogue holds for a book: its Google record, then the art of every
// edition Open Library has, so a reader can choose the printing they actually own instead
// of the one a lookup happened to return first.
export async function lookupCovers({ isbn, title, author, google_books_id }) {
  const covers = [];
  const seen = new Set();
  const add = (url) => {
    if (!url || seen.has(url) || covers.length >= MAX_COVERS) return;
    seen.add(url);
    covers.push(url);
  };

  add(googleCover(google_books_id));

  for (const edition of await openLibraryEditions({ isbn, title, author })) {
    const ids = [edition?.cover_i, ...(Array.isArray(edition?.covers) ? edition.covers : [])];
    for (const id of ids) {
      if (Number(id) > 0) add(`https://covers.openlibrary.org/b/id/${id}-L.jpg`);
    }
    if (covers.length >= MAX_COVERS) break;
  }

  // Hardcover's covers come last: the two catalogues above have already answered, and this
  // one is asked for the printings they may hold no cover for at all.
  if (covers.length < MAX_COVERS) {
    for (const url of await hardcoverCovers({ isbn, title, author })) {
      add(url);
      if (covers.length >= MAX_COVERS) break;
    }
  }

  return covers;
}