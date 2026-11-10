import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  listModerationReports, resolveModerationReport,
  ModerationConflictError, ModerationInputError, ModerationNotFoundError,
} from "./firestoreModeration.js";

function configuredModerators(value = process.env.SHELFLIFE_MODERATOR_UIDS || "") {
  return new Set(String(value).split(",").map((uid) => uid.trim()).filter(Boolean));
}

export function createModerationHandler({
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  listReports = listModerationReports,
  resolveReport = resolveModerationReport,
  moderatorUids = configuredModerators(),
} = {}) {
  if (!["list", "resolve"].includes(operation)) throw new TypeError("Unsupported moderation operation");
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = operation === "list" ? "GET" : "PATCH";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });
    if (!moderatorUids.has(auth.user.uid)) return res.status(403).json({ error: "Moderator access required" });
    if (operation === "resolve" && Object.keys(req.body || {}).some((key) => key !== "action")) {
      return res.status(400).json({ error: "Only a moderation action is accepted" });
    }
    const id = req.query?.id;
    const expectedUpdateTime = req.headers?.["if-match"] || req.headers?.["If-Match"];
    if (operation === "resolve" && (!id || typeof id !== "string")) {
      return res.status(400).json({ error: "A report ID is required" });
    }
    if (operation === "resolve" && (typeof expectedUpdateTime !== "string" || !expectedUpdateTime)) {
      return res.status(428).json({ error: "If-Match version is required" });
    }
    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const result = operation === "list"
        ? await listReports({ db, limit: req.query?.limit === undefined ? 50 : Number(req.query.limit) })
        : await resolveReport({
            db, reportId: id, moderatorUid: auth.user.uid,
            action: req.body?.action, expectedUpdateTime,
          });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof ModerationInputError) return res.status(400).json({ error: error.message });
      if (error instanceof ModerationNotFoundError) return res.status(404).json({ error: "Moderation report not found" });
      if (error instanceof ModerationConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-moderation] request failed", {
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Moderation service unavailable" });
    }
  };
}
