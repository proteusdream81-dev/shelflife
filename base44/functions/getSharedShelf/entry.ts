import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// One book as a stranger may see it: the book itself, and what its owner is doing with
// it — never their notes or rating.
const sharedBook = (b) => ({
  title: b.title,
  author: b.author || '',
  isbn: b.isbn || '',
  cover_url: b.cover_url || '',
  description: b.description || '',
  publisher: b.publisher || '',
  published_date: b.published_date || '',
  page_count: b.page_count || 0,
  categories: b.categories || [],
  buy_links: b.buy_links || [],
  google_books_id: b.google_books_id || '',
  status: b.status || 'to_read',
  format: b.format || '',
  series_name: b.series_name || '',
  series_position: b.series_position || '',
});

// The display name of whoever made the link, so a shared page can say who it
// belongs to. Nothing else about the owner is read.
const readerName = async (base44, userId) => {
  if (!userId) return '';
  try {
    const user = await base44.asServiceRole.entities.User.get(userId);
    return user?.full_name || '';
  } catch {
    return '';
  }
};

// A share link opens one shelf or one book — either way the token is the only key, and a
// link that has been switched off resolves to nothing. This is deliberately the one
// function a stranger may call: a shared link has to open without a login screen, so the
// token itself is the permission. The owner's notes, rating and email never leave here;
// only the display name, because the link was made to be passed on.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const token = (body.token || '').toString().trim();
    if (!token) return Response.json({ error: 'Token is required' }, { status: 400 });

    const shelves = await base44.asServiceRole.entities.Shelf.filter({ share_token: token });
    const shelf = shelves.find((s) => s.share_enabled);
    if (shelf) {
      const books = await base44.asServiceRole.entities.Book.filter({ shelf_id: shelf.id });
      return Response.json({
        kind: 'shelf',
        reader_name: await readerName(base44, shelf.created_by_id),
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
    }

    const books = await base44.asServiceRole.entities.Book.filter({ share_token: token });
    const book = books.find((b) => b.share_enabled);
    if (!book) return Response.json({ error: 'Shared list not found' }, { status: 404 });

    return Response.json({
      kind: 'book',
      reader_name: await readerName(base44, book.created_by_id),
      book: sharedBook(book),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}