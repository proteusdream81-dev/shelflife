import { getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { resolvePublicShare, SharingNotFoundError, SharingConflictError } from "../_lib/firestoreSharing.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const db = await getFirebaseAdminFirestore();
    const result = await resolvePublicShare({ db, token: req.query?.token });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SharingNotFoundError) return res.status(404).json({ error: "Shared item not found" });
    if (error instanceof SharingConflictError) return res.status(409).json({ error: error.message });
    console.error("[firebase-public-share] request failed", {
      name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
      code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
    });
    return res.status(503).json({ error: "Share service unavailable" });
  }
}
