// Blocks, read with the service role. The record itself is private to whoever made it — the
// reader who was blocked is never told — but the effect of a block has to be enforced wherever
// the two could meet, so the check lives here and is shared by every function that needs it.

// Everyone the caller is out of reach of, in either direction: the listeners they blocked and
// the readers who blocked them. Used to keep blocked readers out of lists and search results.
export async function blockedIdsFor(base44, userId) {
  if (!userId) return new Set();
  const [mine, theirs] = await Promise.all([
    base44.asServiceRole.entities.Block.filter({ blocker_id: userId }, '-created_date', 500),
    base44.asServiceRole.entities.Block.filter({ blocked_id: userId }, '-created_date', 500),
  ]);
  return new Set(
    [...mine.map((b) => b.blocked_id), ...theirs.map((b) => b.blocker_id)].filter(Boolean),
  );
}

// Whether these two may not reach each other at all, whichever of them did the blocking.
export async function isBlocked(base44, userId, otherId) {
  if (!userId || !otherId || userId === otherId) return false;
  const [out, back] = await Promise.all([
    base44.asServiceRole.entities.Block.filter({ blocker_id: userId, blocked_id: otherId }),
    base44.asServiceRole.entities.Block.filter({ blocker_id: otherId, blocked_id: userId }),
  ]);
  return out.length > 0 || back.length > 0;
}