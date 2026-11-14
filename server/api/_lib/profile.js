// Keep this projection aligned with the normalized users/{uid} schema
// emitted by scripts/migration/plan.js. Never expose migration metadata or roles.
const PROFILE_FIELDS = Object.freeze([
  "displayName",
  "username",
  "profileHidden",
  "hideCovers",
  "showContentWarnings",
  "storefront",
  "foundingTesterOptedIn",
  "testerPromptDismissed",
]);

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

export class IdentityNotLinkedError extends Error {
  constructor() {
    super("Firebase account has no verified legacy identity link");
    this.name = "IdentityNotLinkedError";
  }
}

export class ProfileNotMigratedError extends Error {
  constructor() {
    super("ShelfLife profile has not been migrated");
    this.name = "ProfileNotMigratedError";
  }
}

/**
 * Resolve only a server-verified Firebase UID. The legacy mapping is private,
 * and the browser never receives the legacy Base44 user ID or role.
 */
export async function resolveShelfLifeProfile({ db, firebaseUser }) {
  const uid = firebaseUser?.uid;
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validUid(uid)) throw new TypeError("A valid Firebase UID is required");

  const linkSnapshot = await db.collection("identityLinks").doc(uid).get();
  const link = linkSnapshot.exists ? linkSnapshot.data() : null;
  if (
    !link ||
    link.status !== "verified" ||
    typeof link.base44UserId !== "string" ||
    !link.base44UserId ||
    link.base44UserId.length > 128 ||
    link.base44UserId.includes("/")
  ) {
    throw new IdentityNotLinkedError();
  }

  const reverseSnapshot = await db.collection("legacyIdentityLinks").doc(link.base44UserId).get();
  const reverseLink = reverseSnapshot.exists ? reverseSnapshot.data() : null;
  const reverseUid = reverseLink?.firestoreUid || reverseLink?.firebaseUid;
  if (!reverseLink || reverseLink.status !== "verified" || reverseUid !== uid) {
    throw new IdentityNotLinkedError();
  }

  const profileSnapshot = await db.collection("users").doc(uid).get();
  if (!profileSnapshot.exists) throw new ProfileNotMigratedError();

  const source = profileSnapshot.data() || {};
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    if (Object.hasOwn(source, field)) profile[field] = source[field];
  }

  return {
    uid,
    email: typeof firebaseUser.email === "string" ? firebaseUser.email : null,
    emailVerified: firebaseUser.emailVerified === true,
    displayName: typeof firebaseUser.displayName === "string" ? firebaseUser.displayName : null,
    profile,
  };
}

export { PROFILE_FIELDS };
