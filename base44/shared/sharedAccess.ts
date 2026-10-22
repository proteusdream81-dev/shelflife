// Who may see a shelf or a book that its owner has shared, and who is out of reach of whom.
// The reading circle and the comment threads are asking the same question - may this reader see
// this shelf, this book, this link - so the answer is worked out in one place, on the server,
// and never left to a page to decide.
import { blockedIdsFor, isBlocked } from './blocks.ts';

const isAccepted = (row) => !row?.status || row?.status === 'accepted';

const named = (item, viewerId) =>
  Boolean(viewerId)
  && (Array.isArray(item?.shared_with_ids) ? item.shared_with_ids : []).includes(viewerId);

async function ownerOf(db, ownerId) {
  if (!ownerId) return null;
  return await db.asServiceRole.entities.User.get(ownerId).catch(() => null);
}

// An accepted follow is what opens a reader's circle-only shares. A request that is still
// waiting opens nothing at all.
async function followsOwner(db, ownerId, viewerId) {
  if (!viewerId || !ownerId || viewerId === ownerId) return false;
  const rows = await db.asServiceRole.entities.Follow.filter(
    { follower_id: viewerId, following_id: ownerId }, '-created_date', 5,
  );
  return rows.some(isAccepted);
}

// A shelf or a book as one viewer may see it, or null. A private shelf stays private whatever
// else is set on it, a hidden profile is open only to the readers it was handed to by name, and
// a block in either direction closes the door entirely.
async function openedFor(db, kind, item, viewerId) {
  if (!item || item.share_enabled !== true) return null;

  const ownerId = item.created_by_id;
  const owner = await ownerOf(db, ownerId);
  if (!owner) return null;

  const mine = viewerId === ownerId;
  const handed = named(item, viewerId);

  if (!mine && viewerId && (await isBlocked(db, viewerId, ownerId))) return null;

  if (!mine && !handed) {
    if (kind === 'shelf' && item.is_private === true) return null;
    if (owner.profile_hidden === true) return null;
    if (item.share_audience === 'selected') return null;
    if (!(await followsOwner(db, ownerId, viewerId))) return null;
  }

  return { kind, item, owner, owner_id: ownerId };
}

export async function shelfForViewer(db, shelfId, viewerId) {
  const shelf = await db.asServiceRole.entities.Shelf.get(shelfId).catch(() => null);
  return openedFor(db, 'shelf', shelf, viewerId);
}

export async function bookForViewer(db, bookId, viewerId) {
  const book = await db.asServiceRole.entities.Book.get(bookId).catch(() => null);
  return openedFor(db, 'book', book, viewerId);
}

// A share link is its own permission: the owner handed the token out, so anyone holding it may
// read what it points at. Nothing else about the owner is opened by it.
export async function shareForToken(db, token) {
  const value = String(token || '').trim();
  if (!value) return null;

  const shelves = await db.asServiceRole.entities.Shelf.filter({ share_token: value }, '-created_date', 5);
  const shelf = shelves.find((row) => row.share_enabled === true);
  if (shelf) {
    return {
      kind: 'shelf',
      item: shelf,
      owner: await ownerOf(db, shelf.created_by_id),
      owner_id: shelf.created_by_id,
    };
  }

  const books = await db.asServiceRole.entities.Book.filter({ share_token: value }, '-created_date', 5);
  const book = books.find((row) => row.share_enabled === true);
  if (!book) return null;

  return {
    kind: 'book',
    item: book,
    owner: await ownerOf(db, book.created_by_id),
    owner_id: book.created_by_id,
  };
}

// Everyone whose words must not appear in a thread: the readers its owner blocked, and the ones
// the viewer blocked or was blocked by. A block is never announced - the comments simply aren't
// there.
export async function outOfReach(db, ownerId, viewerId) {
  const [ownerBlocks, viewerBlocks] = await Promise.all([
    blockedIdsFor(db, ownerId),
    viewerId ? blockedIdsFor(db, viewerId) : Promise.resolve(new Set()),
  ]);
  return new Set([...ownerBlocks, ...viewerBlocks]);
}