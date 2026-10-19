// The whole of one reader's footprint in the app, removed in one place: every table that can hold
// a row about them, the connections and invitations that name them on either side, the roster of a
// club they belonged to, and last of all the account record their sign-in belongs to. It runs with
// the service role, so it reaches the rows a reader may not touch themselves: the markers written
// behind email lookups, requests sitting on another reader's side of a connection, and the account
// itself. Both ways of deleting run through here, the signed-in button and the emailed code, so
// there is only ever one answer to what deleting an account means.
export async function wipeAccount(base44, userId) {
  const entities = base44.asServiceRole.entities;

  // What belongs to them alone. Asked in two batches rather than one long burst, because each call
  // opens a connection and a worker holds only a handful at a time.
  await Promise.all([
    entities.Book.deleteMany({ created_by_id: userId }),
    entities.Shelf.deleteMany({ created_by_id: userId }),
    entities.BookGroup.deleteMany({ created_by_id: userId }),
    entities.Follow.deleteMany({ follower_id: userId }),
    entities.Block.deleteMany({ blocker_id: userId }),
  ]);

  // Connections that name them from the other side: a reader they had followed, one who had
  // followed them, and an invitation either way round. These belong to someone else, which is why
  // they are cleared here and not by the reader, but nothing is left pointing at an account that
  // is gone.
  await Promise.all([
    entities.Follow.deleteMany({ following_id: userId }),
    entities.Block.deleteMany({ blocked_id: userId }),
    entities.GroupInvite.deleteMany({ inviter_id: userId }),
    entities.GroupInvite.deleteMany({ invitee_id: userId }),
    entities.ReaderSearch.deleteMany({ searcher_id: userId }),
  ]);

  // A club keeps its roster on the club itself, which belongs to its owner, so the reader who is
  // leaving is taken out of that roster rather than the club being changed in any other way.
  // Pulled in rounds: one update is capped, and each round stops matching the rows it has changed.
  for (let round = 0; round < 5; round += 1) {
    const pulled = await entities.BookGroup.updateMany(
      { member_ids: userId },
      { $pull: { member_ids: userId } },
    );
    if (!pulled?.has_more) break;
  }

  // The profile last, and with it the sign-in: nothing is left that could be read back or signed
  // into while the rest of the account is still being cleared.
  await entities.User.delete(userId);
}