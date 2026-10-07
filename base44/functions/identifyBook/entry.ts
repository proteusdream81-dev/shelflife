import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchOpenLibrary } from '../../shared/bookSearch.ts';

// Identifies a book from a photo of its cover (or title page) and returns matching books.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const fileUri = typeof body.file_uri === 'string' ? body.file_uri.trim().slice(0, 500) : '';
    if (!fileUri) return Response.json({ error: 'file_uri is required' }, { status: 400 });

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: fileUri,
      expires_in: 300,
    });
    if (!signed || !signed.signed_url) return Response.json({ error: 'Could not read that photo' }, { status: 400 });

    const guess = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: 'You are identifying a book from a photo of its cover or title page. Read the image and identify the book. Return the title, the author, and the ISBN if one is printed on the cover. If the image does not show a book, return empty strings.',
      file_urls: [signed.signed_url],
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          isbn: { type: 'string' },
        },
        required: ['title'],
      },
    });

    const g = guess || {};
    const title = (g.title || '').trim();
    const author = (g.author || '').trim();
    const isbn = (g.isbn || '').replace(/[^0-9Xx]/g, '');

    if (!title && !isbn) return Response.json({ books: [], guess: { title: '', author: '', isbn: '' } });

    let books = [];
    if (isbn) books = await searchOpenLibrary(isbn, 'isbn');
    if (!books.length && title) {
      books = await searchOpenLibrary([title, author].filter(Boolean).join(' '), 'all');
    }

    return Response.json({ books: books.slice(0, 8), guess: { title, author, isbn } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}