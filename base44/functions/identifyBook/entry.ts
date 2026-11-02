import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchBooks } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { withinLimit, tooMany } from '../../shared/rateLimit.ts';
import { serverError } from '../../shared/errors.ts';

// Identifies a book from a photo of its cover (or title page) and returns matching books.
const MAX_IMAGE_CHARS = 6_000_000; // roughly 4.5MB of image bytes once decoded

// Strip a data-URL wrapper and whitespace so both canvas JPEG base64 and file picks work.
function normalizeImagePayload(raw) {
  let text = String(raw || '').trim();
  let mime = 'image/jpeg';
  const dataUrl = text.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrl) {
    mime = dataUrl[1].trim() || mime;
    text = dataUrl[2];
  }
  // Allow whitespace/newlines that some clients insert in long base64 strings.
  text = text.replace(/\s+/g, '');
  // Accept standard and URL-safe base64.
  text = text.replace(/-/g, '+').replace(/_/g, '/');
  return { text, mime };
}

function isBase64(text) {
  return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

// Decode without Uint8Array.from(map) — that pattern blows the stack on multi-MB photos.
function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function looksLikeCreditError(error) {
  const text = `${error?.message || ''} ${error?.error || ''} ${error?.code || ''}`.toLowerCase();
  return /credit|quota|rate.?limit|insufficient|payment.?required|402|429/.test(text);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // Every photo costs an AI credit and a stored file, so scanning is capped per reader.
    if (!(await withinLimit(base44, { actor: user.id, bucket: 'identifyBook', max: 20 }))) {
      return tooMany('You have scanned a lot of covers in the last hour. Please try again a little later.');
    }

    const body = await req.json().catch(() => ({}));
    const { text: image, mime } = normalizeImagePayload(body.image);
    if (!isBase64(image)) {
      return Response.json({ error: 'image is required' }, { status: 400 });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return Response.json({ error: 'That photo is too large to read' }, { status: 413 });
    }

    let bytes;
    try {
      bytes = base64ToBytes(image);
    } catch {
      return Response.json({ error: 'That photo could not be decoded. Try a clearer JPEG or PNG.' }, { status: 400 });
    }
    if (!bytes.length) {
      return Response.json({ error: 'That photo was empty.' }, { status: 400 });
    }

    const file = new File([bytes], 'book-cover.jpg', { type: mime.startsWith('image/') ? mime : 'image/jpeg' });

    let uploaded;
    try {
      uploaded = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    } catch (error) {
      if (looksLikeCreditError(error)) {
        return Response.json({
          error: 'Cover photo needs integration credits. Check Base44 → Settings → Credit usage, then try again.',
        }, { status: 402 });
      }
      console.error('[identifyBook] upload failed', error);
      return Response.json({ error: 'Could not store that photo. Please try again.' }, { status: 502 });
    }
    if (!uploaded || !uploaded.file_uri) {
      return Response.json({ error: 'Could not read that photo' }, { status: 400 });
    }

    let signed;
    try {
      signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: uploaded.file_uri,
        expires_in: 300,
      });
    } catch (error) {
      console.error('[identifyBook] sign failed', error);
      return Response.json({ error: 'Could not read that photo' }, { status: 502 });
    }
    if (!signed || !signed.signed_url) {
      return Response.json({ error: 'Could not read that photo' }, { status: 400 });
    }

    let guess;
    try {
      guess = await base44.asServiceRole.integrations.Core.InvokeLLM({
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
    } catch (error) {
      if (looksLikeCreditError(error)) {
        return Response.json({
          error: 'Cover photo needs integration credits (AI). Check Base44 → Settings → Credit usage.',
        }, { status: 402 });
      }
      console.error('[identifyBook] InvokeLLM failed', error);
      return Response.json({
        error: "We couldn't identify that cover right now. Try barcode or type the ISBN.",
      }, { status: 503 });
    }

    const g = guess || {};
    const title = (g.title || '').trim();
    const author = (g.author || '').trim();
    const isbn = (g.isbn || '').replace(/[^0-9Xx]/g, '');

    if (!title && !isbn) {
      return Response.json({ books: [], guess: { title: '', author: '', isbn: '' } });
    }

    // Catalogue failure must not turn a successful read into a 500 — return the guess so the
    // reader can still fall back to barcode or typed ISBN with a useful title hint.
    let books = [];
    try {
      if (isbn) books = (await searchBooks(isbn, 'isbn', base44)).books || [];
      if (!books.length && title) {
        books = (await searchBooks([title, author].filter(Boolean).join(' '), 'all', base44)).books || [];
      }
    } catch (error) {
      console.error('[identifyBook] catalogue search failed', error);
      books = [];
    }

    return Response.json({ books: books.slice(0, 8), guess: { title, author, isbn } });
  } catch (error) {
    if (looksLikeCreditError(error)) {
      return Response.json({
        error: 'Cover photo needs integration credits. Check Base44 → Settings → Credit usage.',
      }, { status: 402 });
    }
    return serverError(error, 500, "We couldn't read that photo. Please try again.");
  }
}
