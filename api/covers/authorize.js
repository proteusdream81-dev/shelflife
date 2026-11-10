import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "../_lib/profile.js";

function validBookId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1500 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function createCoverAuthorizationHandler({
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified email required" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !validBookId(body.bookId)) {
      return res.status(400).json({ error: "A valid bookId is required" });
    }

    try {
      const db = await getDb();
      // Require the same verified legacy link and migrated profile as all owner-library APIs.
      await resolveProfile({ db, firebaseUser: auth.user });
      const book = await db.collection("users")
        .doc(auth.user.uid)
        .collection("books")
        .doc(body.bookId)
        .get();

      if (!book.exists) return res.status(403).json({ authorized: false });
      return res.status(200).json({ authorized: true, bookId: body.bookId });
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      console.error("[cover-authorization] Firestore lookup failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Book authorization service unavailable" });
    }
  };
}

export default createCoverAuthorizationHandler();
