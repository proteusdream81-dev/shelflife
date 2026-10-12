import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { searchAuthorReleases } from '../../shared/bookSearch.ts';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

const MAX_AUTHORS = 24;
const BATCH_SIZE = 6;
const WINDOW_BACK_DAYS = 365;
const WINDOW_AHEAD_DAYS = 1100;
const DAY_MS = 86400000;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const books = await base44.entities.Book.list('-created_date', 500);

    const authors = [];
    const seenAuthors = new Set();
    for (const book of books) {
      for (const part of String(book.author || '').split(/,\s*/)) {
        const name = part.trim();
        if (!name || seenAuthors.has(name.toLowerCase())) continue;
        seenAuthors.add(name.toLowerCase());
        authors.push(name);
      }
    }

    const selected = authors.slice(0, MAX_AUTHORS);
    if (selected.length === 0) {
      return Response.json({ releases: [], authors_scanned: 0, authors_total: 0 });
    }

    const found = [];
    for (let i = 0; i < selected.length; i += BATCH_SIZE) {
      const batch = selected.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map((author) => searchAuthorReleases(author)));
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') found.push({ author: batch[index], items: result.value });
      });
    }

    const from = Date.now() - WINDOW_BACK_DAYS * DAY_MS;
    const to = Date.now() + WINDOW_AHEAD_DAYS * DAY_MS;
    const candidates = [];

    for (const { author, items } of found) {
      for (const item of items) {
        const at = Date.parse(`${item.date}T00:00:00Z`);
        if (!Number.isFinite(at) || at < from || at > to) continue;
        candidates.push({
          id: item.book.google_books_id || `${item.book.title.toLowerCase()}|${author.toLowerCase()}`,
          dedupe_key: `${item.book.title.toLowerCase()}|${author.toLowerCase()}`,
          title: item.book.title,
          author,
          date: item.date,
          cover_url: item.book.cover_url,
          isbn: item.book.isbn,
        });
      }
    }

    // Earliest dated edition wins for each title.
    candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const seenReleases = new Set();
    const releases = [];
    for (const candidate of candidates) {
      if (seenReleases.has(candidate.dedupe_key)) continue;
      seenReleases.add(candidate.dedupe_key);
      releases.push({
        id: candidate.id,
        title: candidate.title,
        author: candidate.author,
        date: candidate.date,
        cover_url: candidate.cover_url,
        isbn: candidate.isbn,
      });
    }

    return Response.json({
      releases,
      authors_scanned: selected.length,
      authors_total: authors.length,
    });
  } catch (error) {
    return serverError(error, 502, 'Release lookup failed');
  }
}