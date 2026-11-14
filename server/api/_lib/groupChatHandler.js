import { getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { verifyShelfLifeBearerToken } from "./shelfLifeBearerAuth.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  createGroupMessage, deleteGroupMessage, listGroupMessages,
  GroupChatConflictError, GroupChatInputError, GroupChatNotFoundError, GroupChatPermissionError,
} from "./groupChat.js";

const OPERATIONS = new Set(["list", "send", "delete"]);

export function createGroupChatHandler({
  operation,
  verifyToken = verifyShelfLifeBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
} = {}) {
  if (!OPERATIONS.has(operation)) throw new TypeError("Unsupported group chat operation");

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = operation === "list" ? "GET" : operation === "send" ? "POST" : "DELETE";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });

    const groupId = req.query?.id;
    if (typeof groupId !== "string" || !groupId) return res.status(400).json({ error: "A group ID is required" });
    if (operation === "send") {
      const keys = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? Object.keys(req.body) : [];
      if (keys.length !== 1 || keys[0] !== "body") {
        return res.status(400).json({ error: "Only a message body is accepted" });
      }
    }

    try {
      const db = await getDb();
      const resolved = await resolveProfile({ db, firebaseUser: auth.user });
      let result;
      if (operation === "list") {
        const limit = req.query?.limit === undefined ? 50 : Number(req.query.limit);
        const cursor = req.query?.cursor || null;
        result = await listGroupMessages({ db, groupId, uid: auth.user.uid, limit, cursor });
      } else if (operation === "send") {
        result = await createGroupMessage({
          db,
          groupId,
          uid: auth.user.uid,
          displayName: resolved?.profile?.displayName || auth.user.displayName || "",
          body: req.body.body,
        });
      } else {
        result = await deleteGroupMessage({
          db,
          groupId,
          uid: auth.user.uid,
          messageId: req.query?.messageId,
        });
      }
      return res.status(operation === "send" ? 201 : 200).json(result);
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
