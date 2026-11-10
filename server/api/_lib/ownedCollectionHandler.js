import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import { listUserLibraryCollection, USER_LIBRARY_COLLECTIONS, validateLibraryLimit } from "./firestoreLibrary.js";

function parseLimit(value) {
  if (value === undefined || value === null || value === "") return 50;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return validateLibraryLimit(parsed) ? parsed : null;
}

function parseCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 1500 ||
    value === "." ||
    value === ".." ||
    value.includes("/")
  ) return undefined;
  return value;
}

export function createLibraryCollectionHandler({
  collection,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  listCollection = listUserLibraryCollection,
  resolveProfile = resolveShelfLifeProfile,
} = {}) {
  if (!Object.hasOwn(USER_LIBRARY_COLLECTIONS, collection)) {
    throw new TypeError("Unsupported user library collection");
  }

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified email required" });
    }

    const limit = parseLimit(req.query?.limit);
    if (limit === null) return res.status(400).json({ error: "Limit must be between 1 and 100" });

    const cursor = parseCursor(req.query?.cursor);
    if (cursor === undefined) return res.status(400).json({ error: "Invalid pagination cursor" });

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const result = await listCollection({
        db,
        uid: auth.user.uid,
        collection,
        limit,
        cursor,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      console.error("[firebase-library] read failed", {
        collection,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Library data service unavailable" });
    }
  };
}
