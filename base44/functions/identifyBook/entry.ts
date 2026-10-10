import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchOpenLibrary } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';

// Identifies a book from a photo of its cover (or title page) and returns matching books.
const MAX_IMAGE_CHARS = 6_000_000; // roughly 4.5MB of image bytes once decoded

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // The photo arrives as bytes and the function stores it itself, so the file
    // it signs is always the one this caller just sent — never a path they named.
    const body = await req.json().catch(() => ({}));
    const image = typeof body.image === 'string' ? body.image.trim() : '';
    if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return Response.json({ error: 'image is required' }, { status: 400 });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return Response.json({ error: 'That photo is too large to read' }, { status: 413 });
    }

    const file = new File(
      [Uint8Array.from(atob(image), (char) => char.charCodeAt(0))],
      'book-cover.jpg',
      { type: 'image/jpeg' },
    );
    const uploaded = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    if (!uploaded || !uploaded.file_uri) return Response.json({ error: 'Could not read that photo' }, { status: 400 });

    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: uploaded.file_uri,
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