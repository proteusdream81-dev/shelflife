import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchOpenLibrary } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const query = (body.query || '').toString().trim().slice(0, 200);
    if (!query) return Response.json({ error: 'Query is required' }, { status: 400 });
    const type = ['all', 'title', 'author', 'isbn'].includes(body.type) ? body.type : 'all';

    const books = await searchOpenLibrary(query, type);
    return Response.json({ books });
  } catch (error) {
    return Response.json({ error: 'Book search failed', detail: error.message }, { status: 502 });
  }
}