import { base44 } from "@/api/base44Client";

/**
 * Permanently deletes every record owned by the signed-in user.
 * Each query is scoped to created_by_id so only this user's data can match.
 */
export async function deleteAccountData(userId) {
  if (!userId) {
    throw new Error("A signed-in user is required to delete account data");
  }

  const entities = [
    base44.entities.Book,
    base44.entities.Shelf,
    base44.entities.Follow,
    base44.entities.BookGroup,
  ];

  let deleted = 0;
  for (const entity of entities) {
    const result = await entity.deleteMany({ created_by_id: userId });
    deleted += result?.deleted ?? 0;
  }

  return deleted;
}