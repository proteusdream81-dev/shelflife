import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';

// Reading circle: find a reader, follow them, and browse the shelves they have shared.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const action = (body.action || '').toString();

    if (action === 'search') return await findReaders(base44, body, user);
    if (action === 'follow') return await followReader(base44, body, user);
    if (action === 'unfollow') return await unfollowReader(base44, body, user);
    if (action === 'library') return await readerLibrary(base44, body, user);
    if (action === 'overview') return await overview(base44, user);

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Reader lookups are capped per caller, so this can't be used to sweep through email
// addresses and harvest who is registered here.
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 15;

async function findReaders(base44, body, user) {
  const email = (body.email || '').toString().trim().toLowerCase();
  if (!email || !email.includes('@')) return Response.json({ readers: [] });

  if (!(await withinLookupLimit(base44, user.id))) {
    return Response.json({ error: 'Too many reader searches in a row — please try again later.' }, { status: 429 });
  }

  // Record the attempt before the lookup, so guesses that match nobody still count.
  await base44.asServiceRole.entities.ReaderSearch.create({ searcher_id: user.id });

  // Exact email match only, and readers who opted out (profile_hidden) stay invisible.
  const found = await base44.asServiceRole.entities.User.filter({ email }, '-created_date', 5);
  const readers = found
    .filter((u) => u.id !== user.id && !isHidden(u))
    .map((u) => ({ id: u.id, name: u.full_name || u.email }));
  return Response.json({ readers });
}

async function withinLookupLimit(base44, userId) {
  const recent = await base44.asServiceRole.entities.ReaderSearch.filter(
    { searcher_id: userId }, '-created_date', MAX_LOOKUPS_PER_WINDOW,
  );
  if (recent.length < MAX_LOOKUPS_PER_WINDOW) return true;
  const oldest = Date.parse(recent[recent.length - 1]?.created_date || '');
  return !Number.isFinite(oldest) || Date.now() - oldest >= LOOKUP_WINDOW_MS;
}

async function followReader(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId || targetId === user.id) return Response.json({ error: 'That reader cannot be followed' }, { status: 400 });

  const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
  if (!target || isHidden(target)) return Response.json({ error: 'Reader not found' }, { status: 404 });

  const existing = await base44.entities.Follow.filter({ follower_id: user.id, following_id: targetId });
  if (!existing.length) {
    await base44.entities.Follow.create({
      follower_id: user.id,
      follower_name: user.full_name || user.email || '',
      following_id: targetId,
      following_name: target.full_name || target.email || '',
    });
  }
  return Response.json({ ok: true });
}

async function unfollowReader(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const rows = await base44.entities.Follow.filter({ follower_id: user.id, following_id: targetId });
  for (const row of rows) await base44.entities.Follow.delete(row.id);
  return Response.json({ ok: true });
}

async function overview(base44, user) {
  const [followingRows, followerRows, sharedShelves] = await Promise.all([
    base44.asServiceRole.entities.Follow.filter({ follower_id: user.id }, '-created_date', 200),
    base44.asServiceRole.entities.Follow.filter({ following_id: user.id }, '-created_date', 200),
    base44.asServiceRole.entities.Shelf.filter({ share_enabled: true }, '-created_date', 500),
  ]);

  const counts = {};
  sharedShelves.forEach((s) => {
    if (!canSeeShelf(s, user.id)) return;
    counts[s.created_by_id] = (counts[s.created_by_id] || 0) + 1;
  });

  const hidden = await hiddenReaders(base44, [
    ...followingRows.map((r) => r.following_id),
    ...followerRows.map((r) => r.follower_id),
  ]);

  const following = followingRows.filter((r) => !hidden.has(r.following_id)).map((r) => ({
    id: r.following_id,
    name: r.following_name || r.following_id,
    shared_shelves: counts[r.following_id] || 0,
  }));

  const followingIds = following.map((f) => f.id);
  const followers = followerRows.filter((r) => !hidden.has(r.follower_id)).map((r) => ({
    id: r.follower_id,
    name: r.follower_name || r.follower_id,
    shared_shelves: counts[r.follower_id] || 0,
    you_follow: followingIds.includes(r.follower_id),
  }));

  return Response.json({ following, followers });
}

async function readerLibrary(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  // Two ways into a library: following the reader, or something they shared with me by
  // name — a shelf, a single book, or both.
  const [following, shelvesWithMe, booksWithMe] = await Promise.all([
    base44.entities.Follow.filter({ follower_id: user.id, following_id: targetId }),
    base44.asServiceRole.entities.Shelf.filter(
      { created_by_id: targetId, share_enabled: true, shared_with_ids: user.id }, '-created_date', 20,
    ),
    base44.asServiceRole.entities.Book.filter(
      { created_by_id: targetId, share_enabled: true, shared_with_ids: user.id }, '-created_date', 100,
    ),
  ]);
  if (!following.length && !shelvesWithMe.length && !booksWithMe.length) {
    return Response.json({ error: 'Follow this reader to see their shelves' }, { status: 403 });
  }

  const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
  if (!target || (isHidden(target) && !shelvesWithMe.length && !booksWithMe.length)) {
    return Response.json({ error: 'This reader keeps their shelves private' }, { status: 403 });
  }

  // Following a reader shows what they share with their circle plus anything handed to
  // me directly; without a follow, only what was shared with me by name.
  const visible = following.length
    ? { share_enabled: true, $or: [{ share_audience: { $ne: 'selected' } }, { shared_with_ids: user.id }] }
    : { share_enabled: true, shared_with_ids: user.id };

  const [shelves, sharedBooks] = await Promise.all([
    following.length
      ? base44.asServiceRole.entities.Shelf.filter({ created_by_id: targetId, ...visible }, '-created_date', 20)
      : shelvesWithMe,
    following.length
      ? base44.asServiceRole.entities.Book.filter({ created_by_id: targetId, ...visible }, '-created_date', 100)
      : booksWithMe,
  ]);

  const ids = shelves.map((s) => s.id);
  const shelfBooks = ids.length
    ? await base44.asServiceRole.entities.Book.filter({ shelf_id: { $in: ids } }, '-created_date', 300)
    : [];

  const byShelf = {};
  shelfBooks.forEach((b) => {
    (byShelf[b.shelf_id] = byShelf[b.shelf_id] || []).push(toSharedBook(b));
  });

  return Response.json({
    shelves: shelves.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      books: (byShelf[s.id] || []).slice(0, 100),
    })),
    shared_books: sharedBooks.map(toSharedBook),
  });
}

// A book as its owner's circle sees it: the book itself, and what they are doing with it
// — never their notes or rating.
const toSharedBook = (b) => ({
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

const isHidden = (reader) => reader?.profile_hidden === true;

// A shelf shared with chosen readers only stays out of everyone else's shelf list.
const canSeeShelf = (shelf, viewerId) =>
  shelf.share_audience !== 'selected' || (shelf.shared_with_ids || []).includes(viewerId);

// Readers who have hidden their profile stay out of everyone else's reading circle.
async function hiddenReaders(base44, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set();
  const users = await base44.asServiceRole.entities.User.filter({ id: { $in: unique } });
  return new Set(users.filter(isHidden).map((u) => u.id));
}