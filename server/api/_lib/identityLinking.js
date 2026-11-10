function validIdentityId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}

export class IdentityLinkConflictError extends Error {
  constructor() {
    super("These accounts are already linked inconsistently or to another account");
    this.name = "IdentityLinkConflictError";
  }
}

function isConsistentPair(forward, reverse, firebaseUid, base44UserId) {
  return forward?.status === "verified" &&
    forward?.base44UserId === base44UserId &&
    reverse?.status === "verified" &&
    reverse?.firebaseUid === firebaseUid;
}

async function readPair(db, firebaseUid, base44UserId) {
  const [forwardSnapshot, reverseSnapshot] = await Promise.all([
    db.collection("identityLinks").doc(firebaseUid).get(),
    db.collection("legacyIdentityLinks").doc(base44UserId).get(),
  ]);
  return {
    forwardExists: forwardSnapshot.exists,
    reverseExists: reverseSnapshot.exists,
    forward: forwardSnapshot.exists ? forwardSnapshot.data() : null,
    reverse: reverseSnapshot.exists ? reverseSnapshot.data() : null,
  };
}

/**
 * Create a one-to-one mapping only after the caller has independently verified
 * both live sessions. Forward and reverse documents are committed atomically.
 */
export async function createVerifiedIdentityLinkPair({
  db,
  firebaseUser,
  base44User,
  now = () => new Date().toISOString(),
}) {
  const firebaseUid = firebaseUser?.uid;
  const base44UserId = base44User?.id;
  if (!db || typeof db.collection !== "function" ||
      typeof db.createIdentityLinkPair !== "function") {
    throw new TypeError("A Firestore identity-link writer is required");
  }
  if (firebaseUser?.emailVerified !== true) {
    throw new TypeError("A verified Firebase email is required");
  }
  if (!validIdentityId(firebaseUid) || !validIdentityId(base44UserId)) {
    throw new TypeError("Valid Firebase and Base44 identity IDs are required");
  }

  const existing = await readPair(db, firebaseUid, base44UserId);
  if (existing.forwardExists || existing.reverseExists) {
    if (existing.forwardExists && existing.reverseExists &&
        isConsistentPair(existing.forward, existing.reverse, firebaseUid, base44UserId)) {
      return { linked: true, alreadyLinked: true };
    }
    throw new IdentityLinkConflictError();
  }

  try {
    await db.createIdentityLinkPair({
      firebaseUid,
      base44UserId,
      verifiedAt: now(),
    });
    return { linked: true, alreadyLinked: false };
  } catch (error) {
    if (!["ALREADY_EXISTS", "FAILED_PRECONDITION", 409, 412].includes(error?.code)) throw error;
    const afterConflict = await readPair(db, firebaseUid, base44UserId);
    if (afterConflict.forwardExists && afterConflict.reverseExists &&
        isConsistentPair(afterConflict.forward, afterConflict.reverse, firebaseUid, base44UserId)) {
      return { linked: true, alreadyLinked: true };
    }
    throw new IdentityLinkConflictError();
  }
}
