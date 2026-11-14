import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  updateShareSettings,
  SharingConflictError, SharingInputError, SharingNotFoundError, SharingPermissionError,
} from "./firestoreSharing.js";

export function createSharingHandler({
  collection,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  updateSettings = updateShareSettings,
} = {}) {
  if (!["books", "shelves"].includes(collection)) throw new TypeError("Unsupported sharing collection");
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });
    const id = req.query?.id;
    const expectedUpdateTime = req.headers?.["if-match"] || req.headers?.["If-Match"];
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "A library record ID is required" });
    if (typeof expectedUpdateTime !== "string" || !expectedUpdateTime) {
      return res.status(428).json({ error: "If-Match version is required" });
    }
    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const result = await updateSettings({
        db, uid: auth.user.uid, collection, id, input: req.body, expectedUpdateTime,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof SharingInputError) return res.status(400).json({ error: error.message });
      if (error instanceof SharingNotFoundError) return res.status(404).json({ error: "Library record not found" });
      if (error instanceof SharingPermissionError) return res.status(403).json({ error: error.message });
      if (error instanceof SharingConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-sharing] request failed", {
        collection,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Sharing service unavailable" });
    }
  };
}
