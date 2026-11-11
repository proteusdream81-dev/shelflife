
import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { consumeFirebaseRateLimit } from "./rateLimit.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  closeBookGroup, createBookGroup, inviteGroupReader, joinPublicGroup, leaveBookGroup, listBookGroups, listGroupRoster, removeGroupReader, respondToGroupInvite,
  GroupMembershipConflictError, GroupMembershipInputError, GroupMembershipNotFoundError, GroupMembershipPermissionError,
} from "./groupMembership.js";

const OPERATIONS = new Set(["list", "create", "invite", "respond", "remove", "leave", "close", "join", "roster"]);

export function createGroupMembershipHandler({
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  consumeLimit = consumeFirebaseRateLimit,
} = {}) {
  if (!OPERATIONS.has(operation)) throw new TypeError("Unsupported group membership operation");
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = operation === "roster" || operation === "list" ? "GET"
      : operation === "respond" ? "PATCH"
        : operation === "remove" || operation === "leave" || operation === "close" ? "DELETE" : "POST";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });

    if (operation === "invite" && (Object.keys(req.body || {}).length !== 1 || typeof req.body.inviteeUid !== "string")) {
      return res.status(400).json({ error: "Only inviteeUid is accepted" });
    }
    if (operation === "respond" && (Object.keys(req.body || {}).length !== 1 || typeof req.body.decision !== "string")) {
      return res.status(400).json({ error: "Only decision is accepted" });
    }

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "bookGroups", max: 30 });
      if (!allowed) return res.status(429).json({ error: "You have made a lot of club changes in the last hour. Please try again a little later." });
      let result;
      if (operation === "list") {
        const limit = req.query?.limit === undefined ? 50 : Number(req.query.limit);
        result = await listBookGroups({ db, uid: auth.user.uid, scope: req.query?.scope || "mine", limit, cursor: req.query?.cursor || null });
      } else if (operation === "roster") {
        result = await listGroupRoster({ db, groupId: req.query?.id, viewerUid: auth.user.uid });
      } else if (operation === "create") {
        result = await createBookGroup({ db, ownerUid: auth.user.uid, input: req.body });
      } else if (operation === "invite") {
        result = await inviteGroupReader({
          db, groupId: req.query?.id, inviterUid: auth.user.uid, inviteeUid: req.body.inviteeUid,
        });
      } else if (operation === "join") {
        result = await joinPublicGroup({ db, groupId: req.query?.id, uid: auth.user.uid });
      } else if (operation === "respond") {
        result = await respondToGroupInvite({
          db, groupId: req.query?.id, inviteId: req.query?.inviteId,
          inviteeUid: auth.user.uid, decision: req.body.decision,
        });
      } else if (operation === "remove") {
        result = await removeGroupReader({
          db, groupId: req.query?.id, ownerUid: auth.user.uid, targetUid: req.query?.uid,
        });
      } else if (operation === "leave") {
        result = await leaveBookGroup({ db, groupId: req.query?.id, uid: auth.user.uid });
      } else {
        result = await closeBookGroup({ db, groupId: req.query?.id, ownerUid: auth.user.uid });
      }
      return res.status(operation === "create" || operation === "invite" ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof GroupMembershipInputError) return res.status(400).json({ error: error.message });
      if (error instanceof GroupMembershipNotFoundError) return res.status(404).json({ error: "Group or invitation not found" });
      if (error instanceof GroupMembershipPermissionError) return res.status(403).json({ error: error.message });
      if (error instanceof GroupMembershipConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-group-membership] request failed", {
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Group membership service unavailable" });
    }
  };
}
