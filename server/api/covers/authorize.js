import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "../_lib/profile.js";

function validBookId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validCoverObjectKey(value, uid) {
  if (typeof value !== "string" || value.length > 180 || value.includes("..") || value.includes("\\")) return false;
  const parts = value.split("/");
  const filename = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
  return parts.length === 2 && parts[0] === uid && filename.test(parts[1]);
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
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    if (!validBookId(body?.bookId) ||
        !(keys.length === 1 && keys[0] === "bookId") &&
        !(keys.length === 2 && keys.includes("bookId") && keys.includes("objectKey") &&
          validCoverObjectKey(body.objectKey, auth.user.uid))) {
      return res.status(400).json({ error: "A valid bookId and optional owner cover key are required" });
    }

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const book = await db.collection("users")
        .doc(auth.user.uid)
        .collection("books")
        .doc(body.bookId)
        .get();

      if (!book.exists) return res.status(403).json({ authorized: false });
      if (body.objectKey && book.data()?.cover_storage_key !== body.objectKey) {
        return res.status(403).json({ authorized: false });
      }
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
