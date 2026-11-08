import { verifyFirebaseBearerToken } from "../_lib/firebaseAuth.js";

// Identity-only probe for the migration. This does not authorize access to
// Firestore records or replace Base44 sessions in the current application.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = await verifyFirebaseBearerToken(req);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json({ authenticated: true, user: result.user });
}
