import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchBooks } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

// A catalogue that is briefly unreachable — a dropped call, a momentary 5xx — is the
// commonest reason a search comes back empty, so a search that failed outright is asked
// again once before the reader is told it went wrong.
const RETRY_DELAY_MS = 700;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const query = (body.query || '').toString().trim().slice(0, 200);
    if (!query) return Response.json({ error: 'Query is required' }, { status: 400 });
    const type = ['all', 'title', 'author', 'isbn'].includes(body.type) ? body.type : 'all';
    const fresh = body.fresh === true;

    // `partial` says a catalogue was missing from the answer, which the reader is shown as
    // a thinner result rather than as a search that found nothing.
    try {
      const result = await searchBooks(query, type, base44, { fresh });
      return Response.json({ books: result.books, partial: result.partial });
    } catch {
      await wait(RETRY_DELAY_MS);
      const result = await searchBooks(query, type, base44, { fresh });
      return Response.json({ books: result.books, partial: result.partial });
    }
  } catch (error) {
    // A lookup that still fails is reported as a failure, never as "no books found".
    return serverError(error, 502, 'Book search failed');
  }
}