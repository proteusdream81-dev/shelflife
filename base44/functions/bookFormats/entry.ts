import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { lookupFormats, readCachedFormats, writeCachedFormats } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { withinLimit, tooMany } from '../../shared/rateLimit.ts';
import { serverError } from '../../shared/errors.ts';

// The formats one book is published in. A reader picks a search result before adding
// it, so they are told which editions exist to choose between.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // Format lookups ride on the same shared catalogue keys, so they carry the same cap.
    if (!(await withinLimit(base44, { actor: user.id, bucket: 'bookFormats', max: 60 }))) {
      return tooMany('You have looked up a lot of formats in the last hour. Please try again a little later.');
    }

    const body = await req.json().catch(() => ({}));
    const isbn = typeof body.isbn === 'string' ? body.isbn.replace(/[^0-9Xx]/g, '').slice(0, 20) : '';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const author = typeof body.author === 'string' ? body.author.trim().slice(0, 200) : '';
    if (!isbn && !title) return Response.json({ error: 'A title or ISBN is required' }, { status: 400 });

    const key = `formats:${isbn || `${title.toLowerCase()}|${author.toLowerCase()}`}`.slice(0, 220);
    const cached = await readCachedFormats(base44, key);
    if (cached) return Response.json({ formats: cached });

    const formats = await lookupFormats({ isbn, title, author });
    await writeCachedFormats(base44, key, formats);
    return Response.json({ formats });
  } catch (error) {
    return serverError(error, 502, 'Format lookup failed');
  }
}