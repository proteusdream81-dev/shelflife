import { getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { verifyShelfLifeBearerToken } from "./shelfLifeBearerAuth.js";
import { consumeFirebaseRateLimit } from "./rateLimit.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import { listSharedReaderLibrary, SharingConflictError, SharingInputError, SharingNotFoundError, SharingPermissionError } from "./firestoreSharing.js";

export function createReaderLibraryHandler({
  verifyToken = verifyShelfLifeBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  consumeLimit = consumeFirebaseRateLimit,
  listLibrary = listSharedReaderLibrary,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });
    const readerUid = req.query?.uid;
    if (typeof readerUid !== "string" || !readerUid) {
      return res.status(400).json({ error: "A reader ID is required" });
    }
    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleRead", max: 150 });
      if (!allowed) return res.status(429).json({ error: "Too many Reading Circle lookups in one hour. Please try again later." });
      const result = await listLibrary({ db, viewerUid: auth.user.uid, readerUid });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof SharingInputError) return res.status(400).json({ error: error.message });
      if (error instanceof SharingNotFoundError || error instanceof SharingPermissionError) {
        return res.status(404).json({ error: "Shared reader library not found" });
      }
      if (error instanceof SharingConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-reader-library] request failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Shared reader library unavailable" });
    }
  };
}
