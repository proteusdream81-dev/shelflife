import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  createComment, deleteComment, listComments, reportComment,
  CommentConflictError, CommentInputError, CommentNotFoundError, CommentPermissionError,
} from "./firestoreComments.js";

const OPERATIONS = new Set(["list", "create", "delete", "report"]);
export function createCommentsHandler({
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
} = {}) {
  if (!OPERATIONS.has(operation)) throw new TypeError("Unsupported comment operation");
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = operation === "list" ? "GET" : operation === "delete" ? "DELETE" : "POST";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });
    if (operation === "create") {
      const keys = Object.keys(req.body || {});
      if (keys.some((key) => !["targetKind", "targetId", "ownerUid", "body", "parentId"].includes(key))) {
        return res.status(400).json({ error: "Unsupported comment field" });
      }
    }
    if (operation === "report" && Object.keys(req.body || {}).some((key) => key !== "reason")) {
      return res.status(400).json({ error: "Only a report reason is accepted" });
    }
    try {
      const db = await getDb();
      const profile = await resolveProfile({ db, firebaseUser: auth.user });
      let result;
      if (operation === "list") {
        result = await listComments({
          db, uid: auth.user.uid, targetKind: req.query?.targetKind,
          targetId: req.query?.targetId, ownerUid: req.query?.ownerUid,
          limit: req.query?.limit === undefined ? 50 : Number(req.query.limit),
        });
      } else if (operation === "create") {
        result = await createComment({
          db, uid: auth.user.uid, ownerUid: req.body?.ownerUid,
          targetKind: req.body?.targetKind, targetId: req.body?.targetId,
          body: req.body?.body, parentId: req.body?.parentId || null,
        });
      } else if (operation === "delete") {
        result = await deleteComment({ db, uid: auth.user.uid, commentId: req.query?.id });
      } else {
        result = await reportComment({ db, uid: auth.user.uid, commentId: req.query?.id, reason: req.body?.reason });
      }
      return res.status(operation === "create" ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof CommentInputError) return res.status(400).json({ error: error.message });
      if (error instanceof CommentNotFoundError) return res.status(404).json({ error: "Comment or shared target not found" });
      if (error instanceof CommentPermissionError) return res.status(403).json({ error: error.message });
      if (error instanceof CommentConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-comments] request failed", {
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Comments service unavailable" });
    }
  };
}
