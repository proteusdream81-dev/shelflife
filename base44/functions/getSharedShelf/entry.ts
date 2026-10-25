import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { serverError } from '../../shared/errors.ts';
import { withinGuestLimit, tooMany } from '../../shared/rateLimit.ts';

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
  romance_subgenre: b.romance_subgenre || '',
});

// The display name of whoever made the link, so a shared page can say who it belongs to, and
// whether they keep their covers to themselves. Nothing else about the owner is read.
const readerInfo = async (base44, userId) => {
  if (!userId) return { name: '', hide_covers: false };
  try {
    const user = await base44.asServiceRole.entities.User.get(userId);
    return { name: user?.full_name || '', hide_covers: user?.hide_covers === true };
  } catch {
    return { name: '', hide_covers: false };
  }
};

// A share link opens one shelf or one book — either way the token is the only key, and a
// link that has been switched off resolves to nothing. This is deliberately the one
// function a stranger may call: a shared link has to open without a login screen, so the
// token itself is the permission. The owner's notes, rating and email never leave here;
// only the display name, because the link was made to be passed on. A reader who has hidden
// their covers gets the artwork left out entirely, rather than trusting the page to hide it.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const token = (body.token || '').toString().trim();
    if (!token) return Response.json({ error: 'Token is required' }, { status: 400 });

    // Anyone may call this, so the connection is counted rather than a reader: a page that really
    // was opened a handful of times is served, while a script working through tokens is not.
    if (!(await withinGuestLimit(base44, req, { bucket: 'getSharedShelf', max: 120 }))) {
      return tooMany('That link has been opened a lot just now. Please try again in a little while.');
    }

    const shelves = await base44.asServiceRole.entities.Shelf.filter({ share_token: token });
    const shelf = shelves.find((s) => s.share_enabled);
    if (shelf) {
      const owner = await readerInfo(base44, shelf.created_by_id);
      const books = await base44.asServiceRole.entities.Book.filter({ shelf_id: shelf.id });
      return Response.json({
        kind: 'shelf',
        reader_name: owner.name,
        covers_hidden: owner.hide_covers,
        shelf: { name: shelf.name, description: shelf.description || '' },
        books: books.map((b) => ({
          title: b.title,
          author: b.author || '',
          cover_url: owner.hide_covers ? '' : (b.cover_url || ''),
          publisher: b.publisher || '',
          published_date: b.published_date || '',
          status: b.status || 'to_read',
        })),
      });
    }

    const books = await base44.asServiceRole.entities.Book.filter({ share_token: token });
    const book = books.find((b) => b.share_enabled);
    if (!book) return Response.json({ error: 'Shared list not found' }, { status: 404 });

    const owner = await readerInfo(base44, book.created_by_id);
    return Response.json({
      kind: 'book',
      reader_name: owner.name,
      covers_hidden: owner.hide_covers,
      book: owner.hide_covers ? { ...sharedBook(book), cover_url: '' } : sharedBook(book),
    });
  } catch (error) {
    // This is the one function anyone may call, so an unexpected failure says nothing
    // about what broke — only that the link could not be opened.
    return serverError(error, 500, 'Something went wrong opening this link. Please try again.');
  }
}