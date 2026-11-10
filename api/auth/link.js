import { verifyFirebaseBearerToken } from "../_lib/firebaseAuth.js";
import { getFirebaseAdminFirestore } from "../_lib/firebaseAuth.js";
import { verifyBase44Session, InvalidBase44SessionError } from "../_lib/base44Session.js";
import { createVerifiedIdentityLinkPair, IdentityLinkConflictError } from "../_lib/identityLinking.js";

export function createIdentityLinkHandler({
  verifyFirebaseToken = verifyFirebaseBearerToken,
  verifyLegacySession = verifyBase44Session,
  getDb = getFirebaseAdminFirestore,
  linkAccounts = createVerifiedIdentityLinkPair,
  writesEnabled = () => process.env.MIGRATION_LINK_WRITES_ENABLED === "true",
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const firebaseAuth = await verifyFirebaseToken(req);
    if (!firebaseAuth.ok) return res.status(firebaseAuth.status).json({ error: firebaseAuth.error });
    if (firebaseAuth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified Firebase email required" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["base44Token", "dryRun"].includes(key)) ||
        typeof body.base44Token !== "string" ||
        !body.base44Token ||
        body.base44Token.length > 10000 ||
        /\s/.test(body.base44Token) ||
        (body.dryRun !== undefined && typeof body.dryRun !== "boolean")) {
      return res.status(400).json({ error: "A valid legacy session token is required" });
    }

    let base44User;
    try {
      base44User = await verifyLegacySession(body.base44Token);
    } catch (error) {
      if (error instanceof InvalidBase44SessionError) {
        return res.status(401).json({ error: "Legacy Base44 session could not be verified" });
      }
      console.error("[identity-link] legacy session verification unavailable", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
      });
      return res.status(503).json({ error: "Legacy account verification service unavailable" });
    }

    if (!base44User || typeof base44User.id !== "string" || !base44User.id) {
      return res.status(401).json({ error: "Legacy Base44 session could not be verified" });
    }

    // Dry-run proof is always read-only, even if a write flag is accidentally enabled.
    if (body.dryRun === true) {
      return res.status(200).json({
        proofVerified: true,
        linked: false,
        writesDisabled: true,
        dryRun: true,
      });
    }

    // Authoritative Firestore writes remain disabled until the migration owner
    // explicitly enables this flag after the migration and restore gates pass.
    if (!writesEnabled()) {
      return res.status(200).json({
        proofVerified: true,
        linked: false,
        writesDisabled: true,
      });
    }

    try {
      const db = await getDb();
      const result = await linkAccounts({
        db,
        firebaseUser: firebaseAuth.user,
        base44User,
      });
      return res.status(200).json({
        proofVerified: true,
        linked: result.linked === true,
        alreadyLinked: result.alreadyLinked === true,
        writesDisabled: false,
      });
    } catch (error) {
      if (error instanceof IdentityLinkConflictError) {
        return res.status(409).json({ error: "These accounts are already linked inconsistently or to another account" });
      }
      console.error("[identity-link] Firestore link write failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Account linking service unavailable" });
    }
  };
}

export default createIdentityLinkHandler();
