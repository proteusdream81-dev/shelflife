import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { withinLimit, tooMany } from '../../shared/rateLimit.ts';
import { serverError } from '../../shared/errors.ts';

// The reader's own Google Calendar, connected one reader at a time, so the release dates land
// in the calendar they actually look at.
const CONNECTOR_ID = '6ada1fa329791f10bff48f77';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_BOOKS = 60;
const MAX_REMINDERS = 400;
const PAGE_SIZE = 200;

// A reminder is only worth making from a whole date. A month, or a bare year, is not a launch
// day, so those books are left off rather than given a guessed one.
function fullDate(value: string) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? '' : date;
}

// An all-day event ends the day after it starts.
function nextDay(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

function eventBody(item) {
  return {
    summary: `Release day: ${item.title}`,
    description: [item.author ? `by ${item.author}` : '', 'Release date from your Want to Read shelf on ShelfLife.']
      .filter(Boolean)
      .join('\n'),
    start: { date: item.release_date },
    end: { date: nextDay(item.release_date) },
    transparency: 'transparent',
    reminders: { useDefault: true },
  };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    // One sync can write dozens of events to the reader's own calendar, so it is capped per reader.
    if (!(await withinLimit(base44, { actor: user.id, bucket: 'releaseReminders', max: 12 }))) {
      return tooMany('You have synced your calendar a lot in the last hour. Please try again a little later.');
    }

    let accessToken = '';
    try {
      const connection = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
      accessToken = connection?.accessToken || '';
    } catch {
      accessToken = '';
    }
    if (!accessToken) return Response.json({ connected: false, reminders: [] });

    // Every book on the Want to Read shelf, a page at a time.
    const books = [];
    let cursor;
    do {
      const page = await base44.entities.Book.filter({ status: 'to_read' }, { limit: PAGE_SIZE, cursor });
      books.push(...(page.items || []));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    const today = new Date().toISOString().slice(0, 10);
    const wanted = new Map();
    for (const book of books) {
      if (wanted.size >= MAX_BOOKS) break;
      const release_date = fullDate(book.published_date);
      if (!release_date || release_date < today) continue;
      wanted.set(book.id, {
        book_id: book.id,
        title: book.title || 'Untitled',
        author: book.author || '',
        release_date,
      });
    }

    const saved = await base44.entities.ReleaseReminder.list('-created_date', MAX_REMINDERS);
    const byBook = new Map(saved.map((row) => [row.book_id, row]));

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    let added = 0;
    let updated = 0;
    let removed = 0;
    let expired = false;

    // A revoked or withdrawn grant is not a failure to retry: the reader is simply no longer
    // connected, and the card in the app asks them to connect again.
    const call = async (url, init = {}) => {
      const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) expired = true;
      return res;
    };

    for (const item of wanted.values()) {
      if (expired) break;
      const row = byBook.get(item.book_id);
      try {
        if (!row) {
          const res = await call(CALENDAR_API, { method: 'POST', body: JSON.stringify(eventBody(item)) });
          if (!res.ok) continue;
          const event = await res.json();
          const created = await base44.entities.ReleaseReminder.create({ ...item, event_id: event.id });
          byBook.set(item.book_id, created);
          added += 1;
        } else if (row.release_date !== item.release_date || row.title !== item.title) {
          const res = await call(`${CALENDAR_API}/${encodeURIComponent(row.event_id)}`, {
            method: 'PATCH',
            body: JSON.stringify(eventBody(item)),
          });
          if (!res.ok) continue;
          const patch = { ...item, event_id: row.event_id };
          await base44.entities.ReleaseReminder.update(row.id, patch);
          byBook.set(item.book_id, { ...row, ...patch });
          updated += 1;
        }
      } catch (error) {
        console.error('[releaseReminders] keeping one release failed', item.book_id, error);
      }
    }

    // A book taken off the shelf, or one whose launch has passed, comes off the calendar too.
    for (const row of saved) {
      if (expired) break;
      if (wanted.has(row.book_id)) continue;
      try {
        if (row.event_id) {
          const res = await call(`${CALENDAR_API}/${encodeURIComponent(row.event_id)}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404 && res.status !== 410) continue;
        }
        await base44.entities.ReleaseReminder.delete(row.id);
        byBook.delete(row.book_id);
        removed += 1;
      } catch (error) {
        console.error('[releaseReminders] removing one release failed', row.book_id, error);
      }
    }

    if (expired) return Response.json({ connected: false, reminders: [] });

    const reminders = [...wanted.values()]
      .map((item) => ({ ...item, event_id: byBook.get(item.book_id)?.event_id || '' }))
      .filter((item) => item.event_id)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));

    return Response.json({ connected: true, reminders, added, updated, removed });
  } catch (error) {
    return serverError(error, 502, 'Calendar sync failed');
  }
}