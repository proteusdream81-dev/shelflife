import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupSeries } from '../../shared/bookSearch.ts';

// Looks up whether a single book belongs to a series, and which volume it is.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const isbn = typeof body.isbn === 'string' ? body.isbn.replace(/[^0-9Xx]/g, '').slice(0, 20) : '';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const author = typeof body.author === 'string' ? body.author.trim().slice(0, 200) : '';
    if (!isbn && !title) return Response.json({ error: 'A title or ISBN is required' }, { status: 400 });

    const series = await lookupSeries({ isbn, title, author });
    return Response.json(series);
  } catch (error) {
    return Response.json({ error: 'Series lookup failed', detail: error.message }, { status: 502 });
  }
}