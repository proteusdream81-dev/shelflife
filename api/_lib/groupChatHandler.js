import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  createGroupMessage, deleteGroupMessage, listGroupMessages,
  GroupChatInputError, GroupChatNotFoundError, GroupChatPermissionError, GroupChatConflictError,
} from "./groupChat.js";

export function createGroupChatHandler({
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
} = {}) {
  if (!["list", "create", "delete"].includes(operation)) throw new TypeError("Unsupported group chat operation");
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = operation === "list" ? "GET" : operation === "create" ? "POST" : "DELETE";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });
    const groupId = operation === "delete" ? req.query?.groupId : operation === "create" ? req.body?.groupId : req.query?.groupId;
    if (typeof groupId !== "string" || !groupId) return res.status(400).json({ error: "A group ID is required" });
    if (operation === "create" && Object.keys(req.body || {}).some((key) => !["groupId", "body"].includes(key))) {
      return res.status(400).json({ error: "Only groupId and body are accepted" });
    }
    if (operation === "delete" && typeof req.query?.messageId !== "string") {
      return res.status(400).json({ error: "A message ID is required" });
    }
    try {
      const db = await getDb();
      const profile = await resolveProfile({ db, firebaseUser: auth.user });
      const args = { db, groupId, uid: auth.user.uid };
      let result;
      if (operation === "list") {
        const limit = req.query?.limit === undefined ? 50 : Number(req.query.limit);
        result = await listGroupMessages({ ...args, limit, cursor: req.query?.cursor || null });
      } else if (operation === "create") {
        result = await createGroupMessage({
          ...args,
          displayName: profile?.profile?.displayName || profile?.displayName || auth.user.displayName,
          body: req.body?.body,
        });
      } else {
        result = await deleteGroupMessage({ ...args, messageId: req.query.messageId });
      }
      return res.status(operation === "create" ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof GroupChatInputError) return res.status(400).json({ error: error.message });
      if (error instanceof GroupChatNotFoundError) return res.status(404).json({ error: "Group or message not found" });
      if (error instanceof GroupChatPermissionError) return res.status(403).json({ error: error.message });
      if (error instanceof GroupChatConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-group-chat] request failed", {
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Group chat service unavailable" });
    }
  };
}
