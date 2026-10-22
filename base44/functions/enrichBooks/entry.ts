import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupBook, lookupCovers } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

const MAX_BOOKS = 12;
const BATCH = 4;

// Fills in the catalogue's own record for books a reader already has — the titles an
// import brought across, which arrive as little more than a title and a reading status.
// Each book is matched on its ISBN where it has a real one and on title and author
// otherwise, because a Kindle export carries an ASIN rather than an ISBN, and the ASIN is
// passed along so a book matched that way is known to be a Kindle edition. A match is only
// returned when its title and author agree with the book asked for; anything else comes
// back as a miss, so the record keeps the reader's own data rather than another book's.
// The answer comes back one book at a time, so an import can show which were found and
// which were not.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const asked = Array.isArray(body.books) ? body.books.slice(0, MAX_BOOKS) : [];
    const books = asked
      .map((book) => ({
        key: String(book?.key || '').slice(0, 120),
        title: String(book?.title || '').trim().slice(0, 200),
        author: String(book?.author || '').trim().slice(0, 200),
        isbn: String(book?.isbn || '').replace(/[^0-9Xx]/g, '').slice(0, 20),
        asin: String(book?.asin || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 20),
      }))
      .filter((book) => book.title || book.isbn || book.asin);

    if (!books.length) return Response.json({ results: [] });

    // A matched book the catalogues hold no cover art for still has the covers its other
    // editions carry, and those are asked for here so a shelf shows a real cover rather
    // than a placeholder. A book that already has one costs no extra lookup.
    const enrich = async (book) => {
      const found = await lookupBook(book, base44);
      if (!found.book) return { ...found, covers: [] };
      if (/^https?:\/\//.test(String(found.book.cover_url || ''))) return { ...found, covers: [] };
      const covers = await lookupCovers({
        isbn: found.book.isbn || book.isbn,
        title: found.book.title,
        author: found.book.author,
        google_books_id: found.book.google_books_id,
      }).catch(() => []);
      return { ...found, covers: Array.isArray(covers) ? covers : [] };
    };

    const results = [];
    // Four lookups at a time: each may make two upstream calls, and the runtime holds six
    // connections at once.
    for (let i = 0; i < books.length; i += BATCH) {
      const settled = await Promise.allSettled(books.slice(i, i + BATCH).map(enrich));
      settled.forEach((result, index) => {
        const book = books[i + index];
        const found = result.status === 'fulfilled' ? result.value : null;
        results.push(found && found.book
          ? { key: book.key, matched: true, source: found.source, book: found.book, covers: found.covers || [] }
          : { key: book.key, matched: false, source: '', book: null, covers: [] });
      });
    }

    return Response.json({ results });
  } catch (error) {
    return serverError(error, 502, 'We could not look those books up');
  }
}