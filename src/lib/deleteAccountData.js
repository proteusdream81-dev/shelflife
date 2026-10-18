import { base44 } from "@/api/base44Client";

// Every table a reader can own a row in, and may therefore remove by themselves. Each query is
// scoped to the signed-in reader, so only their own records can match. ReaderSearch is left out
// on purpose: it holds nothing but a marker of who ran an email lookup, the table is admin-only,
// and a refusal there would stop the rest of the deletion.
const ownedEntities = () => [
  base44.entities.Book,
  base44.entities.Shelf,
  base44.entities.BookGroup,
  base44.entities.Follow,
  base44.entities.Block,
  base44.entities.GroupInvite,
];

/**
 * Permanently deletes everything belonging to the signed-in reader, then releases their name.
 * Every query names the reader explicitly, so nothing outside their own account is touched.
 */
export async function deleteAccountData(userId) {
  if (!userId) {
    throw new Error("A signed-in user is required to delete account data");
  }

  for (const entity of ownedEntities()) {
    await entity.deleteMany({ created_by_id: userId });
  }

  // The other half of a connection: requests and follows of this reader, written by other
  // readers. The rules on the table let the reader they point at remove them.
  await base44.entities.Follow.deleteMany({ following_id: userId });

  // What is left of the profile: the username goes back into the pool for someone else to
  // claim, and the profile stops coming up when readers are searched for.
  await base44.auth.updateMe({ username: "", profile_hidden: true });
}