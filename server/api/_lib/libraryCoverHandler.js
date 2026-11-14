import { getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { verifyShelfLifeBearerToken } from "./shelfLifeBearerAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  updateUserBookCover,
  InvalidLibraryInputError,
  LibraryRecordNotFoundError,
  LibraryWriteConflictError,
} from "./firestoreLibraryWrites.js";

export function createLibraryCoverHandler({
  verifyToken = verifyShelfLifeBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  updateCover = updateUserBookCover,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "PUT") {
      res.setHeader("Allow", "PUT");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified email required" });
    }

    const id = req.query?.id;
    const expectedUpdateTime = req.headers?.["if-match"] || req.headers?.["If-Match"];
    const body = req.body;
    if (typeof id !== "string" || !id || id.length > 1500 || id.includes("/")) {
      return res.status(400).json({ error: "A valid book ID is required" });
    }
    if (typeof expectedUpdateTime !== "string" || !expectedUpdateTime) {
      return res.status(428).json({ error: "If-Match version is required" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof body.objectKey !== "string") {
      return res.status(400).json({ error: "A cover objectKey is required" });
    }

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const record = await updateCover({
        db,
        uid: auth.user.uid,
        id,
        objectKey: body.objectKey,
        expectedUpdateTime,
      });
      return res.status(200).json({ record });
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof InvalidLibraryInputError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof LibraryRecordNotFoundError) {
        return res.status(404).json({ error: "Library record not found" });
      }
      if (error instanceof LibraryWriteConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error("[firebase-library] cover metadata write failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Library data service unavailable" });
    }
  };
}
