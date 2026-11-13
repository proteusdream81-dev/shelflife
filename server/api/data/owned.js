import { getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { verifyShelfLifeBearerToken } from "../_lib/shelfLifeBearerAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError as ProfileIdentityNotLinkedError, ProfileNotMigratedError } from "../_lib/profile.js";
import { listOwnedRecords, validateOwnedEntity } from "../_lib/firestoreData.js";

export function createOwnedDataDiagnosticHandler({
  verifyToken = verifyShelfLifeBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  listRecords = listOwnedRecords,
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

    // This endpoint exists only for the Preview auth diagnostic. Never return
    // legacy records through it, even when a caller omits countOnly.
    if (req.query?.countOnly !== "true") {
      return res.status(400).json({ error: "Count-only diagnostics are required" });
    }

    const entity = typeof req.query?.entity === "string" ? req.query.entity : "";
    if (!validateOwnedEntity(entity)) {
      return res.status(400).json({ error: "Unsupported entity" });
    }

    const rawLimit = req.query?.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Limit must be between 1 and 100" });
    }

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const records = await listRecords({ db, firebaseUid: auth.user.uid, entity, limit });
      return res.status(200).json({
        entity,
        count: records.length,
        capped: records.length === limit,
      });
    } catch (error) {
      if (error instanceof ProfileIdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      console.error("[owned-data] read failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
        message: typeof error?.message === "string" ? error.message.slice(0, 300) : "No error message",
      });
      return res.status(503).json({ error: "Data service unavailable" });
    }
  };
}

export default createOwnedDataDiagnosticHandler();
