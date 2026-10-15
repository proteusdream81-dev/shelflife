import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupBook } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

const MAX_BOOKS = 12;
const BATCH = 4;

// Fills in the catalogue's own record for books a reader already has — the titles an
// import brought across, which arrive as little more than a title and a reading status.
// Each book is matched on its ISBN where it has one and on title and author otherwise,
// because a Kindle export carries an ASIN rather than an ISBN. The answer comes back one
// book at a time, so an import can show which of them were found and which were not.
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
      }))
      .filter((book) => book.title || book.isbn);

    if (!books.length) return Response.json({ results: [] });

    const results = [];
    // Four lookups at a time: each may make two upstream calls, and the runtime holds six
    // connections at once.
    for (let i = 0; i < books.length; i += BATCH) {
      const settled = await Promise.allSettled(
        books.slice(i, i + BATCH).map((book) => lookupBook(book, base44)),
      );
      settled.forEach((result, index) => {
        const book = books[i + index];
        const found = result.status === 'fulfilled' ? result.value : null;
        results.push(found && found.book
          ? { key: book.key, matched: true, source: found.source, book: found.book }
          : { key: book.key, matched: false, source: '', book: null });
      });
    }

    return Response.json({ results });
  } catch (error) {
    return serverError(error, 502, 'We could not look those books up');
  }
}