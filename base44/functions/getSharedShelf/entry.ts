import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const token = (body.token || '').toString().trim();
    if (!token) return Response.json({ error: 'Token is required' }, { status: 400 });

    const shelves = await base44.asServiceRole.entities.Shelf.filter({ share_token: token });
    if (!shelves.length) return Response.json({ error: 'Shared list not found' }, { status: 404 });
    const shelf = shelves[0];
    if (!shelf.share_enabled) return Response.json({ error: 'Shared list not found' }, { status: 404 });

    const books = await base44.asServiceRole.entities.Book.filter({ shelf_id: shelf.id });
    return Response.json({
      shelf: { name: shelf.name, description: shelf.description || '' },
      books: books.map((b) => ({
        title: b.title,
        author: b.author || '',
        cover_url: b.cover_url || '',
        publisher: b.publisher || '',
        published_date: b.published_date || '',
        status: b.status || 'to_read',
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}