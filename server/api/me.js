import { getFirebaseAdminFirestore } from "./_lib/firebaseAuth.js";
import { verifyShelfLifeBearerToken } from "./_lib/shelfLifeBearerAuth.js";
import {
  IdentityNotLinkedError,
  ProfileNotMigratedError,
  resolveShelfLifeProfile,
} from "./_lib/profile.js";

export function createMeHandler({
  verifyToken = verifyShelfLifeBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
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
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified email required" });
    }

    try {
      const db = await getDb();
      const user = await resolveProfile({ db, firebaseUser: auth.user });
      return res.status(200).json({ user });
    } catch (error) {
      if (error instanceof IdentityNotLinkedError) {
        return res.status(409).json({ error: "Account link is not established" });
      }
      if (error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Profile migration is not complete" });
      }
      console.error("[firebase-me] profile resolution failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Profile service unavailable" });
    }
  };
}

export default createMeHandler();
