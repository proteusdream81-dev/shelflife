// Firestore access stays server-side. Client Firestore access remains denied by firestore.rules.
// This first migration slice is intentionally owner-only and read-only.

export const OWNER_SCOPED_ENTITIES = Object.freeze([
  "Book",
  "Shelf",
  "BookGroup",
  "Follow",
  "Block",
  "ReleaseReminder",
]);

const ENTITY_SET = new Set(OWNER_SCOPED_ENTITIES);

export class IdentityNotLinkedError extends Error {
  constructor() {
    super("Firebase account has no verified legacy identity link");
    this.name = "IdentityNotLinkedError";
  }
}

export function validateOwnedEntity(entity) {
  return typeof entity === "string" && ENTITY_SET.has(entity);
}

/**
 * Resolve an explicit, operator-provisioned Firebase UID -> Base44 user ID link,
 * then return only records whose immutable legacy created_by_id matches it.
 * Never infer or create a link from an email address.
 */
export async function listOwnedRecords({ db, firebaseUid, entity, limit = 50 }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore client is required");
  if (typeof firebaseUid !== "string" || !firebaseUid || firebaseUid.length > 128) {
    throw new TypeError("A valid Firebase UID is required");
  }
  if (!validateOwnedEntity(entity)) throw new TypeError("Entity is not available in the owner-only migration API");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Limit must be an integer from 1 to 100");

  const linkSnapshot = await db.collection("identityLinks").doc(firebaseUid).get();
  const link = linkSnapshot.exists ? linkSnapshot.data() : null;
  if (
    !link ||
    link.status !== "verified" ||
    typeof link.base44UserId !== "string" ||
    !link.base44UserId ||
    link.base44UserId.length > 128
  ) {
    throw new IdentityNotLinkedError();
  }

  const snapshot = await db.collection(entity)
    .where("created_by_id", "==", link.base44UserId)
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
