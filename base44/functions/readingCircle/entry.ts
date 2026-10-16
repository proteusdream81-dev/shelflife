import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';
import { blockedIdsFor, isBlocked } from '../../shared/blocks.ts';

// Reading circle: find a reader, ask to follow them, answer the requests others send you, block
// someone who will not take no for an answer, and browse the shelves a reader has shared. Every
// decision about who may see what is made here, on the server, never in the client.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const action = (body.action || '').toString();

    if (action === 'search') return await findReaders(base44, body, user);
    if (action === 'follow') return await requestFollow(base44, body, user);
    if (action === 'unfollow') return await unfollowReader(base44, body, user);
    if (action === 'respond') return await respondToRequest(base44, body, user);
    if (action === 'remove_follower') return await removeFollower(base44, body, user);
    if (action === 'block') return await blockReader(base44, body, user);
    if (action === 'unblock') return await unblockReader(base44, body, user);
    if (action === 'username') return await claimUsername(base44, body, user);
    if (action === 'library') return await readerLibrary(base44, body, user);
    if (action === 'overview') return await overview(base44, user);

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}

// A follow saved before requests existed carries no status, and is an accepted follow.
const isAccepted = (row) => !row?.status || row?.status === 'accepted';
const isPending = (row) => row?.status === 'pending';

const displayName = (reader) => reader?.full_name || reader?.email || '';

// ---------- Finding a reader ----------

// Both ways of looking a reader up are capped per caller, so neither can be used to sweep the
// app for a list of who is here. An email has to be known already to be typed, so it gets the
// tighter cap; searching a name is ordinary use and gets a looser one.
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_EMAIL_LOOKUPS = 15;
const MAX_NAME_SEARCHES = 60;

const escapePattern = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findReaders(base44, body, user) {
  const email = (body.email || '').toString().trim().toLowerCase();
  const query = (body.query || '').toString().trim();

  const byEmail = email.includes('@');
  if (!byEmail && query.length < 2) return Response.json({ readers: [] });

  const cap = byEmail ? MAX_EMAIL_LOOKUPS : MAX_NAME_SEARCHES;
  if (!(await withinLookupLimit(base44, user.id, cap))) {
    return Response.json({ error: 'Too many reader searches in a row — please try again later.' }, { status: 429 });
  }

  // Record the attempt before the lookup, so guesses that match nobody still count.
  await base44.asServiceRole.entities.ReaderSearch.create({ searcher_id: user.id });

  // An email has to match exactly. A name or username is looked up the way a reader types it:
  // the username whole, the name anywhere in it. Readers who opted out of being found
  // (profile_hidden) stay invisible either way.
  const found = byEmail
    ? await base44.asServiceRole.entities.User.filter({ email }, '-created_date', 5)
    : await base44.asServiceRole.entities.User.filter(
      {
        $or: [
          { username: { $regex: `^${escapePattern(query.replace(/^@+/, ''))}$`, $options: 'i' } },
          { full_name: { $regex: escapePattern(query), $options: 'i' } },
        ],
      },
      '-created_date', 20,
    );

  const blocked = await blockedIdsFor(base44, user.id);
  const readers = found
    .filter((u) => u.id !== user.id && !isHidden(u) && !blocked.has(u.id))
    .slice(0, 10);

  const states = await followStates(base44, user.id, readers.map((u) => u.id));

  return Response.json({
    readers: readers.map((u) => ({
      id: u.id,
      name: u.full_name || u.email || 'Reader',
      username: u.username || '',
      state: states[u.id] || 'none',
    })),
  });
}

async function withinLookupLimit(base44, userId, cap) {
  const recent = await base44.asServiceRole.entities.ReaderSearch.filter(
    { searcher_id: userId }, '-created_date', cap,
  );
  if (recent.length < cap) return true;
  const oldest = Date.parse(recent[recent.length - 1]?.created_date || '');
  return !Number.isFinite(oldest) || Date.now() - oldest >= LOOKUP_WINDOW_MS;
}

// The state of the caller's own ask to each reader: none, pending, or accepted.
async function followStates(base44, followerId, ids) {
  const wanted = [...new Set(ids.filter(Boolean))].slice(0, 50);
  if (!wanted.length) return {};
  const rows = await base44.asServiceRole.entities.Follow.filter(
    { follower_id: followerId, following_id: { $in: wanted } }, '-created_date', 200,
  );
  const states = {};
  rows.forEach((row) => {
    states[row.following_id] = isAccepted(row) ? 'accepted' : 'pending';
  });
  return states;
}

// ---------- Asking, answering, blocking ----------

async function requestFollow(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId || targetId === user.id) return Response.json({ error: 'That reader cannot be followed' }, { status: 400 });

  // A block in either direction stops the request. Nothing about the block is revealed: as far
  // as the sender can tell, the reader simply cannot be followed.
  if (await isBlocked(base44, user.id, targetId)) {
    return Response.json({ error: 'That reader cannot be followed' }, { status: 403 });
  }

  const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
  if (!target || isHidden(target)) return Response.json({ error: 'Reader not found' }, { status: 404 });

  const existing = await base44.entities.Follow.filter({ follower_id: user.id, following_id: targetId });
  if (existing.some(isPending)) return Response.json({ ok: true, state: 'pending' });
  if (existing.some(isAccepted)) return Response.json({ ok: true, state: 'accepted' });

  await base44.entities.Follow.create({
    follower_id: user.id,
    follower_name: displayName(user),
    following_id: targetId,
    following_name: displayName(target),
    status: 'pending',
  });
  return Response.json({ ok: true, state: 'pending' });
}

async function unfollowReader(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const rows = await base44.entities.Follow.filter({ follower_id: user.id, following_id: targetId });
  for (const row of rows) await base44.entities.Follow.delete(row.id);
  return Response.json({ ok: true });
}

// Only the reader a request is addressed to may answer it. The row is read with the service
// role because it belongs to the sender, and this function is where the two are checked
// against each other — a request can never be accepted by the reader who sent it.
async function respondToRequest(base44, body, user) {
  const followerId = (body.user_id || '').toString();
  const accept = body.accept === true;
  if (!followerId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Follow.filter(
    { follower_id: followerId, following_id: user.id }, '-created_date', 5,
  );
  const waiting = rows.find(isPending);
  if (!waiting) return Response.json({ error: 'That request is no longer waiting' }, { status: 404 });

  if (accept) {
    if (await isBlocked(base44, user.id, followerId)) {
      await base44.asServiceRole.entities.Follow.delete(waiting.id);
      return Response.json({ error: 'That request could not be accepted' }, { status: 403 });
    }
    // The row belongs to the reader who asked, and no app user is allowed to write a follow's
    // status at all — so the answer is given here, by the reader it was addressed to, with the
    // check above standing in front of it.
    await base44.asServiceRole.entities.Follow.update(waiting.id, { status: 'accepted' });
    return Response.json({ ok: true, state: 'accepted' });
  }

  // Refusing simply drops the request: neither side keeps a record of it.
  await base44.asServiceRole.entities.Follow.delete(waiting.id);
  return Response.json({ ok: true, state: 'none' });
}

// A follower the reader no longer wants in their circle. The follow is theirs to end, so the
// delete is allowed by the entity's own rule for whoever a follow points at.
async function removeFollower(base44, body, user) {
  const followerId = (body.user_id || '').toString();
  if (!followerId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const rows = await base44.asServiceRole.entities.Follow.filter(
    { follower_id: followerId, following_id: user.id }, '-created_date', 20,
  );
  for (const row of rows) await base44.asServiceRole.entities.Follow.delete(row.id);
  return Response.json({ ok: true });
}

async function blockReader(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId || targetId === user.id) return Response.json({ error: 'That reader cannot be blocked' }, { status: 400 });

  const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
  if (!target) return Response.json({ error: 'Reader not found' }, { status: 404 });

  const already = await base44.entities.Block.filter({ blocker_id: user.id, blocked_id: targetId });
  if (!already.length) {
    await base44.entities.Block.create({
      blocker_id: user.id,
      blocker_name: displayName(user),
      blocked_id: targetId,
      blocked_name: displayName(target),
    });
  }

  // Blocking ends the relationship whichever way it ran: anything either reader had asked for
  // is gone, and neither can reach the other while the block stands.
  const [mine, theirs] = await Promise.all([
    base44.asServiceRole.entities.Follow.filter({ follower_id: user.id, following_id: targetId }, '-created_date', 20),
    base44.asServiceRole.entities.Follow.filter({ follower_id: targetId, following_id: user.id }, '-created_date', 20),
  ]);
  for (const row of [...mine, ...theirs]) await base44.asServiceRole.entities.Follow.delete(row.id);

  return Response.json({ ok: true });
}

async function unblockReader(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const rows = await base44.entities.Block.filter({ blocker_id: user.id, blocked_id: targetId });
  for (const row of rows) await base44.entities.Block.delete(row.id);
  return Response.json({ ok: true });
}

// ---------- The reader's own name ----------

const USERNAME = /^[a-z0-9_]{3,20}$/;

// Whether a username is free is the one thing a reader cannot check for themselves — reading
// other people's profiles is closed to them — so the claim is decided here. The profile itself
// is then written by its owner, so no function ever edits another reader's record.
async function claimUsername(base44, body, user) {
  const wanted = (body.username || '').toString().trim().replace(/^@+/, '').toLowerCase();
  if (!USERNAME.test(wanted)) {
    return Response.json({ error: 'A username is 3-20 letters, numbers or underscores.' }, { status: 400 });
  }

  const taken = await base44.asServiceRole.entities.User.filter({ username: wanted }, '-created_date', 5);
  if (taken.some((u) => u.id !== user.id)) {
    return Response.json({ error: 'That username is already taken.' }, { status: 409 });
  }

  return Response.json({ ok: true, username: wanted });
}

// ---------- The circle ----------

async function overview(base44, user) {
  const [outbound, inbound, sharedShelves, myBlocks, blocked] = await Promise.all([
    base44.asServiceRole.entities.Follow.filter({ follower_id: user.id }, '-created_date', 300),
    base44.asServiceRole.entities.Follow.filter({ following_id: user.id }, '-created_date', 300),
    base44.asServiceRole.entities.Shelf.filter(
      { share_enabled: true, is_private: { $ne: true } }, '-created_date', 500,
    ),
    base44.entities.Block.filter({ blocker_id: user.id }, '-created_date', 300),
    blockedIdsFor(base44, user.id),
  ]);

  const counts = {};
  sharedShelves.forEach((s) => {
    if (!canSeeShelf(s, user.id)) return;
    counts[s.created_by_id] = (counts[s.created_by_id] || 0) + 1;
  });

  const hidden = await hiddenReaders(base44, [
    ...outbound.map((r) => r.following_id),
    ...inbound.map((r) => r.follower_id),
  ]);

  // A reader who is hidden, or blocked either way round, is out of every list here.
  const unreachable = (id) => hidden.has(id) || blocked.has(id);

  const following = outbound
    .filter((r) => isAccepted(r) && !unreachable(r.following_id))
    .map((r) => ({
      id: r.following_id,
      name: r.following_name || r.following_id,
      shared_shelves: counts[r.following_id] || 0,
    }));

  const requested = outbound
    .filter((r) => isPending(r) && !unreachable(r.following_id))
    .map((r) => ({ id: r.following_id, name: r.following_name || r.following_id }));

  const followingIds = following.map((f) => f.id);
  const followers = inbound
    .filter((r) => isAccepted(r) && !unreachable(r.follower_id))
    .map((r) => ({
      id: r.follower_id,
      name: r.follower_name || r.follower_id,
      shared_shelves: counts[r.follower_id] || 0,
      you_follow: followingIds.includes(r.follower_id),
    }));

  const requests = inbound
    .filter((r) => isPending(r) && !unreachable(r.follower_id))
    .map((r) => ({ id: r.follower_id, name: r.follower_name || r.follower_id }));

  const blockedReaders = myBlocks.map((b) => ({ id: b.blocked_id, name: b.blocked_name || b.blocked_id }));

  const suggested = await suggestReaders(base44, user, counts, blocked);

  return Response.json({ following, requested, followers, requests, blocked: blockedReaders, suggested });
}

// Readers who already share a shelf with their circle are visible to anyone who follows
// them, so the only thing standing between a new reader and those shelves was knowing the
// right email address. These are suggestions only: never an email, never a hidden profile,
// and never a reader already in the caller's circle.
async function suggestReaders(base44, user, counts, blocked) {
  const [outbound, inbound] = await Promise.all([
    base44.asServiceRole.entities.Follow.filter({ follower_id: user.id }, '-created_date', 300),
    base44.asServiceRole.entities.Follow.filter({ following_id: user.id }, '-created_date', 300),
  ]);

  const known = new Set([
    user.id,
    ...outbound.map((r) => r.following_id),
    ...inbound.map((r) => r.follower_id),
  ]);
  const ids = Object.keys(counts)
    .filter((id) => counts[id] > 0 && !known.has(id) && !blocked.has(id))
    .slice(0, 50);
  if (!ids.length) return [];

  const users = await base44.asServiceRole.entities.User.filter({ id: { $in: ids } });
  return users
    .filter((u) => !isHidden(u) && u.full_name)
    .slice(0, 10)
    .map((u) => ({ id: u.id, name: u.full_name, shared_shelves: counts[u.id] }));
}

// ---------- A reader's shelves ----------

async function readerLibrary(base44, body, user) {
  const targetId = (body.user_id || '').toString();
  if (!targetId) return Response.json({ error: 'user_id is required' }, { status: 400 });

  const [following, sharedWithMe, sharedBooksWithMe, privateShelves, blocked] = await Promise.all([
    base44.asServiceRole.entities.Follow.filter({ follower_id: user.id, following_id: targetId }, '-created_date', 5),
    base44.asServiceRole.entities.Shelf.filter(
      { created_by_id: targetId, share_enabled: true, is_private: { $ne: true }, shared_with_ids: user.id },
      '-created_date', 20,
    ),
    base44.asServiceRole.entities.Book.filter(
      { created_by_id: targetId, share_enabled: true, shared_with_ids: user.id }, '-created_date', 100,
    ),
    base44.asServiceRole.entities.Shelf.filter({ created_by_id: targetId, is_private: true }, '-created_date', 100),
    isBlocked(base44, user.id, targetId),
  ]);

  if (blocked) {
    return Response.json({ error: 'This reader keeps their shelves private' }, { status: 403 });
  }

  // Only an accepted follow, or something handed to me by name, opens a library. A request
  // that is still waiting shows nothing.
  const accepted = following.some(isAccepted);
  const named = sharedWithMe.length > 0 || sharedBooksWithMe.length > 0;
  if (!accepted && !named) {
    if (following.some(isPending)) {
      return Response.json({ error: 'Your follow request is waiting for their answer' }, { status: 403 });
    }
    return Response.json({ error: 'Follow this reader to see their shelves' }, { status: 403 });
  }

  const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
  if (!target || (isHidden(target) && !named)) {
    return Response.json({ error: 'This reader keeps their shelves private' }, { status: 403 });
  }

  // A shelf marked private is private to everyone, whatever else is set on it, so neither it
  // nor any book filed on it may leave here — not to a follower, and not to a reader it was
  // handed to by name.
  const privateIds = new Set(privateShelves.map((s) => s.id));
  const visibleBook = (b) => !privateIds.has(b.shelf_id) && !privateIds.has(b.id);

  // Following a reader shows what they share with their circle plus anything handed to
  // me directly; without a follow, only what was shared with me by name.
  const visible = accepted
    ? { share_enabled: true, $or: [{ share_audience: { $ne: 'selected' } }, { shared_with_ids: user.id }] }
    : { share_enabled: true, shared_with_ids: user.id };

  const [shelves, sharedBooks] = await Promise.all([
    accepted
      ? base44.asServiceRole.entities.Shelf.filter(
        { created_by_id: targetId, is_private: { $ne: true }, ...visible }, '-created_date', 20,
      )
      : sharedWithMe,
    accepted
      ? base44.asServiceRole.entities.Book.filter({ created_by_id: targetId, ...visible }, '-created_date', 200)
      : sharedBooksWithMe,
  ]);

  const ids = shelves.map((s) => s.id);
  const shelfBooks = ids.length
    ? await base44.asServiceRole.entities.Book.filter({ shelf_id: { $in: ids } }, '-created_date', 300)
    : [];

  const byShelf = {};
  shelfBooks.filter(visibleBook).forEach((b) => {
    (byShelf[b.shelf_id] = byShelf[b.shelf_id] || []).push(toSharedBook(b));
  });

  return Response.json({
    shelves: shelves.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      books: (byShelf[s.id] || []).slice(0, 100),
    })),
    shared_books: sharedBooks.filter(visibleBook).map(toSharedBook),
  });
}

// A book as a reader's circle sees it: the book itself, what they are doing with it, and the
// rating they gave it — never their private notes. Only ever reached with an accepted follow
// or a share made to that reader by name; a stranger opening a share link is given
// getSharedShelf's narrower view instead.
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
  rating: b.rating || 0,
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