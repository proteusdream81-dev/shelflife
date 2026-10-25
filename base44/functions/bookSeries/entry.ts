import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupSeries } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { withinLimit, tooMany } from '../../shared/rateLimit.ts';
import { serverError } from '../../shared/errors.ts';

// Looks up whether a single book belongs to a series, and which volume it is.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // A series lookup walks a book's editions on the public catalogue, so it is capped per reader.
    if (!(await withinLimit(base44, { actor: user.id, bucket: 'bookSeries', max: 60 }))) {
      return tooMany('You have looked up a lot of series in the last hour. Please try again a little later.');
    }

    const body = await req.json().catch(() => ({}));
    const isbn = typeof body.isbn === 'string' ? body.isbn.replace(/[^0-9Xx]/g, '').slice(0, 20) : '';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const author = typeof body.author === 'string' ? body.author.trim().slice(0, 200) : '';
    if (!isbn && !title) return Response.json({ error: 'A title or ISBN is required' }, { status: 400 });

    const series = await lookupSeries({ isbn, title, author });
    return Response.json(series);
  } catch (error) {
    return serverError(error, 502, 'Series lookup failed');
  }
}