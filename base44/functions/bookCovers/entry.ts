import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupCovers } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { withinLimit, tooMany } from '../../shared/rateLimit.ts';
import { serverError } from '../../shared/errors.ts';

// The cover art a book was published with, one entry per edition, so a reader can pick the
// printing they own when the first cover a search returned isn't it.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // Cover art is looked up on the same shared catalogue keys as a search, so one reader's
    // lookups are capped the same way.
    if (!(await withinLimit(base44, { actor: user.id, bucket: 'bookCovers', max: 60 }))) {
      return tooMany('You have looked up a lot of covers in the last hour. Please try again a little later.');
    }

    const body = await req.json().catch(() => ({}));
    const isbn = String(body.isbn || '').replace(/[^0-9Xx]/g, '').slice(0, 20);
    const title = String(body.title || '').trim().slice(0, 200);
    const author = String(body.author || '').trim().slice(0, 200);
    const googleBooksId = String(body.google_books_id || '').trim().slice(0, 40);

    if (!isbn && !title) return Response.json({ covers: [] });

    const covers = await lookupCovers({ isbn, title, author, google_books_id: googleBooksId });
    return Response.json({ covers });
  } catch (error) {
    return serverError(error, 502, 'We could not find other covers for that book');
  }
}