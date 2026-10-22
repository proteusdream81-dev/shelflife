import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { searchBooks } from '../../shared/bookSearch.ts';
import { serverError } from '../../shared/errors.ts';

// The Monday scan behind the weekly digest. It reads what the owner actually reads, asks the
// catalogues what is out there for those genres, keeps the answers in BookSearchCache, and
// reports only the titles this run has not seen before and that the owner does not own.
// Workflow-only: the workflow calls it as the app admin, so anyone else is turned away.

const GENRE_COUNT = 3;
// Used in place of the owner's own genres only when their shelves say nothing yet.
const DEFAULT_GENRES = ['Romance', 'Fantasy', 'Mystery & thriller'];
const RESULTS_PER_GENRE = 12;
const SEEN_CAP = 800;
const PAGE_SIZE = 200;
const SHELF_PAGES = 3;
const SEEN_KEY = 'trending:seen';

const clean = (value) => String(value ?? '').trim();

// "Fiction / Romance" is filed under the genre a reader would name, not the shelf above it.
const genreLabel = (value) => {
  const parts = clean(value).split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
};

const fold = (value) => clean(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const bookKey = (book) => `${fold(book?.title)}|${fold(book?.author)}`;

function pickGenres(books) {
  const counts = new Map();
  for (const book of books) {
    for (const raw of Array.isArray(book.categories) ? book.categories : []) {
      const label = genreLabel(raw);
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
  const picked = ranked.slice(0, GENRE_COUNT);
  for (const fallback of DEFAULT_GENRES) {
    if (picked.length >= GENRE_COUNT) break;
    if (!picked.some((label) => fold(label) === fold(fallback))) picked.push(fallback);
  }
  return picked;
}

async function ownedBooks(base44, userId) {
  const books = [];
  let cursor;
  for (let page = 0; page < SHELF_PAGES; page += 1) {
    const answer = await base44.asServiceRole.entities.Book.filter(
      { created_by_id: userId },
      { limit: PAGE_SIZE, cursor },
    );
    books.push(...(answer.items || []));
    if (!answer.has_more) break;
    cursor = answer.next_cursor;
  }
  return books;
}

async function readSeen(base44) {
  const { items } = await base44.asServiceRole.entities.BookSearchCache.filter({ cache_key: SEEN_KEY });
  const record = items[0];
  const seen = new Set();
  for (const entry of Array.isArray(record?.books) ? record.books : []) {
    const key = bookKey(entry);
    if (key !== '|') seen.add(key);
  }
  return { record, seen };
}

// One cache record per genre, holding only what the app would show: the answer replaces the
// previous one so the cache never grows a shelf of its own.
async function saveGenreCache(base44, genre, books) {
  const cacheKey = `trending:${fold(genre)}`.slice(0, 220);
  const rows = books.slice(0, RESULTS_PER_GENRE).map((book) => ({
    title: clean(book.title),
    author: clean(book.author),
    isbn: clean(book.isbn),
    cover_url: clean(book.cover_url),
    published_date: clean(book.published_date),
    categories: Array.isArray(book.categories) ? book.categories.slice(0, 4) : [],
  }));
  const { items } = await base44.asServiceRole.entities.BookSearchCache.filter({ cache_key: cacheKey });
  if (items[0]) await base44.asServiceRole.entities.BookSearchCache.update(items[0].id, { books: rows });
  else await base44.asServiceRole.entities.BookSearchCache.create({ cache_key: cacheKey, books: rows });
}

async function saveSeen(base44, record, keys) {
  const books = keys.slice(0, SEEN_CAP).map((key) => {
    const [title, author] = key.split('|');
    return { title, author };
  });
  if (record) await base44.asServiceRole.entities.BookSearchCache.update(record.id, { books });
  else await base44.asServiceRole.entities.BookSearchCache.create({ cache_key: SEEN_KEY, books });
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const shelf = await ownedBooks(base44, user.id);
    const genres = pickGenres(shelf);
    const owned = new Set(shelf.map(bookKey).filter((key) => key !== '|'));
    const { record: seenRecord, seen } = await readSeen(base44);

    const found = [];
    for (const genre of genres) {
      try {
        const answer = await searchBooks(genre, 'all', base44, { fresh: true });
        const books = Array.isArray(answer.books) ? answer.books : [];
        await saveGenreCache(base44, genre, books);
        found.push({ genre, books });
      } catch (error) {
        // One genre the catalogues could not answer still lets the other two report.
        console.log(`[weeklyTrending] "${genre}" skipped: ${error?.message || error}`);
        found.push({ genre, books: [] });
      }
    }

    const fresh = [];
    const freshKeys = new Set();
    for (const { books } of found) {
      for (const book of books) {
        const key = bookKey(book);
        if (key === '|' || owned.has(key) || seen.has(key) || freshKeys.has(key)) continue;
        freshKeys.add(key);
        fresh.push({ title: clean(book.title), author: clean(book.author), cover_url: clean(book.cover_url) });
        if (fresh.length >= RESULTS_PER_GENRE) break;
      }
      if (fresh.length >= RESULTS_PER_GENRE) break;
    }

    const allKeys = new Set([...seen, ...owned, ...freshKeys]);
    await saveSeen(base44, seenRecord, [...allKeys].map((key) => key).slice(0, SEEN_CAP));

    const firstName = clean(user.full_name).split(' ')[0] || 'reader';
    return Response.json({
      ok: true,
      owner_email: fresh.length ? clean(user.email) : '',
      first_name: firstName,
      genres,
      genre_list: genres.join(', '),
      new_count: fresh.length,
      book_list: fresh.map((book) => (book.author ? `${book.title} by ${book.author}` : book.title)).join('\n'),
      books: fresh,
    });
  } catch (error) {
    return serverError(error, 500, 'The weekly trending scan failed');
  }
}