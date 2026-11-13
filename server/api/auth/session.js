import { verifyShelfLifeBearerToken } from "../_lib/shelfLifeBearerAuth.js";

// Identity-only probe for already-linked Firebase identities or verified
// Base44 compatibility sessions. This does not write Firestore data.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = await verifyShelfLifeBearerToken(req);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json({ authenticated: true, user: result.user });
}
