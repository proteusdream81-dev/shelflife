import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupSeries } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

// Looks up whether a single book belongs to a series, and which volume it is.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

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