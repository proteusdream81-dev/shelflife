import { verifyBase44Session, InvalidBase44SessionError } from "./base44Session.js";

/**
 * Verify a live Base44 session for the isolated migration Preview.
 * This endpoint proves the legacy session can be validated server-side; it
 * does not create Firebase accounts, link identities, or read/write user data.
 */
export function createBase44SessionProofHandler({
  verifySession = verifyBase44Session,
  allowedDeployment = () =>
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/base44-session-bridge",
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!allowedDeployment()) {
      return res.status(404).json({ error: "Not found" });
    }

    const authorization = req.headers?.authorization || req.headers?.Authorization;
    if (typeof authorization !== "string" || !/^Bearer\s/i.test(authorization)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authorization.slice(7).trim();
    if (!token || token.length > 10000 || /\s/.test(token)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const user = await verifySession(token);
      if (!user || typeof user.id !== "string" || !user.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      // Never return or log the Base44 user ID or session token.
      return res.status(200).json({
        authenticated: true,
        identityProvider: "base44",
        migrationMode: "compatibility-preview",
        firebaseAccountLinked: false,
        dataAccessEnabled: false,
      });
    } catch (error) {
      if (error instanceof InvalidBase44SessionError) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      console.error("[base44-session-proof] verification unavailable", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
      });
      return res.status(503).json({ error: "Legacy authentication service unavailable" });
    }
  };
}

export default createBase44SessionProofHandler();
