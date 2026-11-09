import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { IdentityNotLinkedError, listOwnedRecords, validateOwnedEntity } from "../_lib/firestoreData.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Authorization");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await verifyFirebaseBearerToken(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (auth.user.emailVerified !== true) {
    return res.status(403).json({ error: "Verified email required" });
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
    const db = await getFirebaseAdminFirestore();
    const records = await listOwnedRecords({ db, firebaseUid: auth.user.uid, entity, limit });
    return res.status(200).json({ entity, count: records.length, records });
  } catch (error) {
    if (error instanceof IdentityNotLinkedError) {
      return res.status(409).json({ error: "Account link is not established" });
    }
    // Fail closed. Do not return Firestore or identity-link internals to clients.
    return res.status(503).json({ error: "Data service unavailable" });
  }
}
