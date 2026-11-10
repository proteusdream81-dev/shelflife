import { randomUUID, createHash } from "node:crypto";

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}
function validUid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}
function cleanText(value, max, field, required = false) {
  if (typeof value !== "string") throw new GroupMembershipInputError(`${field} must be text`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new GroupMembershipInputError(`${field} must be ${required ? "1 to " : "at most "}${max} characters`);
  }
  return text;
}
export function groupInviteId(groupId, inviteeUid) {
  return createHash("sha256").update(`${groupId}\0${inviteeUid}`).digest("hex");
}
export class GroupMembershipInputError extends Error {
  constructor(message) { super(message); this.name = "GroupMembershipInputError"; }
}
export class GroupMembershipNotFoundError extends Error {
  constructor() { super("Group or invitation not found"); this.name = "GroupMembershipNotFoundError"; }
}
export class GroupMembershipPermissionError extends Error {
  constructor(message = "You are not allowed to manage this group") { super(message); this.name = "GroupMembershipPermissionError"; }
}
export class GroupMembershipConflictError extends Error {
  constructor(message = "This group membership changed; refresh and try again") { super(message); this.name = "GroupMembershipConflictError"; }
}

async function getGroup(db, groupId) {
  if (!validId(groupId)) throw new GroupMembershipInputError("A valid group ID is required");
  const ref = db.collection("groups").doc(groupId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new GroupMembershipNotFoundError();
  const group = snapshot.data() || {};
  if (group.status === "closed") throw new GroupMembershipNotFoundError();
  return { ref, snapshot, group };
}
async function requireVerifiedReader(db, uid) {
  if (!validUid(uid)) throw new GroupMembershipInputError("A valid reader ID is required");
  const [profile, forward] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("identityLinks").doc(uid).get(),
  ]);
  const link = forward.exists ? forward.data() || {} : {};
  if (!profile.exists || link.status !== "verified" || !validId(link.base44UserId)) {
    throw new GroupMembershipNotFoundError();
  }
  const reverse = await db.collection("legacyIdentityLinks").doc(link.base44UserId).get();
  const reverseLink = reverse.exists ? reverse.data() || {} : {};
  if (reverseLink.status !== "verified" || reverseLink.firebaseUid !== uid) {
    throw new GroupMembershipNotFoundError();
  }
  return profile.data() || {};
}
async function requireOwner(db, groupId, uid) {
  if (!validUid(uid)) throw new GroupMembershipInputError("A valid owner ID is required");
  const value = await getGroup(db, groupId);
  if (value.group.ownerUid !== uid) throw new GroupMembershipPermissionError();
  return value;
}

export async function createBookGroup({ db, ownerUid, input, createId = randomUUID, now = () => new Date().toISOString() }) {
  await requireVerifiedReader(db, ownerUid);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GroupMembershipInputError("Group details are required");
  const allowed = new Set(["name", "description", "category", "location", "bookTitle", "isPrivate"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new GroupMembershipInputError("Unsupported group fields");
  if (typeof input.isPrivate !== "boolean") throw new GroupMembershipInputError("isPrivate must be a boolean");
  const id = createId();
  if (!validId(id)) throw new GroupMembershipInputError("Invalid generated group ID");
  const timestamp = now();
  const record = {
    ownerUid,
    name: cleanText(input.name, 80, "Group name", true),
    description: cleanText(input.description || "", 1000, "Description"),
    category: cleanText(input.category || "", 80, "Category"),
    location: cleanText(input.location || "", 120, "Location"),
    bookTitle: cleanText(input.bookTitle || "", 160, "Book title"),
    isPrivate: input.isPrivate,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
  };
  const groupRef = db.collection("groups").doc(id);
  const created = await groupRef.create(record);
  try {
    await groupRef.collection("members").doc(ownerUid).create({
      uid: ownerUid, role: "owner", status: "active", joinedAt: timestamp, schemaVersion: 1,
    });
  } catch (error) {
    await groupRef.delete({ lastUpdateTime: created?.updateTime }).catch(() => {});
    throw error;
  }
  return { id, ...record };
}

export async function inviteGroupReader({ db, groupId, inviterUid, inviteeUid, now = () => new Date().toISOString() }) {
  const { ref, group } = await requireOwner(db, groupId, inviterUid);
  if (inviterUid === inviteeUid) throw new GroupMembershipInputError("You cannot invite yourself");
  await requireVerifiedReader(db, inviteeUid);
  const [member, removed] = await Promise.all([
    ref.collection("members").doc(inviteeUid).get(),
    ref.collection("removed").doc(inviteeUid).get(),
  ]);
  if (removed.exists) throw new GroupMembershipConflictError("A removed reader cannot be re-invited");
  if (member.exists && member.data()?.status === "active") throw new GroupMembershipConflictError("Reader is already a member");
  const id = groupInviteId(groupId, inviteeUid);
  const invites = ref.collection("invites");
  const existing = await invites.doc(id).get();
  if (existing.exists) {
    const row = existing.data() || {};
    if (row.inviterUid !== inviterUid || row.inviteeUid !== inviteeUid) throw new GroupMembershipConflictError();
    if (row.status === "pending") return { id, status: "pending", alreadyExists: true };
    throw new GroupMembershipConflictError("An invitation already exists for this reader");
  }
  const timestamp = now();
  await invites.doc(id).create({
    inviterUid, inviteeUid, status: "pending", createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1,
  });
  return { id, groupId, status: "pending", isPrivate: group.isPrivate === true, alreadyExists: false };
}

export async function respondToGroupInvite({ db, groupId, inviteId: id, inviteeUid, decision, now = () => new Date().toISOString() }) {
  if (!validId(id)) throw new GroupMembershipInputError("A valid invitation ID is required");
  if (!["accept", "decline"].includes(decision)) throw new GroupMembershipInputError("Decision must be accept or decline");
  const { ref } = await getGroup(db, groupId);
  await requireVerifiedReader(db, inviteeUid);
  const inviteRef = ref.collection("invites").doc(id);
  const snapshot = await inviteRef.get();
  if (!snapshot.exists) throw new GroupMembershipNotFoundError();
  const invite = snapshot.data() || {};
  if (invite.inviteeUid !== inviteeUid) throw new GroupMembershipPermissionError();
  const removed = await ref.collection("removed").doc(inviteeUid).get();
  if (removed.exists) throw new GroupMembershipPermissionError("You have been removed from this group");
  const memberRef = ref.collection("members").doc(inviteeUid);
  const memberSnapshot = await memberRef.get();
  if (invite.status === "accepted" && decision === "accept") {
    if (memberSnapshot.exists && memberSnapshot.data()?.status === "active") {
      return { accepted: true, alreadyAccepted: true };
    }
    if (memberSnapshot.exists && memberSnapshot.updateTime) {
      await memberRef.update({
        uid: inviteeUid, role: "member", status: "active", joinedAt: now(), schemaVersion: 1,
      }, { lastUpdateTime: memberSnapshot.updateTime });
    } else {
      await memberRef.create({ uid: inviteeUid, role: "member", status: "active", joinedAt: now(), schemaVersion: 1 });
    }
    return { accepted: true, alreadyAccepted: false };
  }
  if (invite.status !== "pending") throw new GroupMembershipConflictError();
  if (!snapshot.updateTime) throw new GroupMembershipConflictError();
  const status = decision === "accept" ? "accepted" : "declined";
  try {
    await inviteRef.update({ status, updatedAt: now() }, { lastUpdateTime: snapshot.updateTime });
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) throw new GroupMembershipConflictError();
    throw error;
  }
  if (decision === "decline") return { accepted: false, declined: true };

  if (memberSnapshot.exists && memberSnapshot.updateTime) {
    await memberRef.update({
      uid: inviteeUid, role: "member", status: "active", joinedAt: now(), schemaVersion: 1,
    }, { lastUpdateTime: memberSnapshot.updateTime });
  } else {
    await memberRef.create({ uid: inviteeUid, role: "member", status: "active", joinedAt: now(), schemaVersion: 1 });
  }
  return { accepted: true, alreadyAccepted: false };
}

async function createRemovedMarker(ref, uid, now) {
  const marker = ref.collection("removed").doc(uid);
  const existing = await marker.get();
  if (existing.exists) return;
  try {
    await marker.create({ uid, removedAt: now(), schemaVersion: 1 });
  } catch (error) {
    if (!["ALREADY_EXISTS", 409].includes(error?.code)) throw error;
  }
}

export async function removeGroupReader({ db, groupId, ownerUid, targetUid, now = () => new Date().toISOString() }) {
  const { ref } = await requireOwner(db, groupId, ownerUid);
  if (!validUid(targetUid) || targetUid === ownerUid) throw new GroupMembershipInputError("The group owner cannot be removed");
  await createRemovedMarker(ref, targetUid, now);
  const memberRef = ref.collection("members").doc(targetUid);
  const member = await memberRef.get();
  if (member.exists && member.updateTime) {
    await memberRef.update({ status: "removed", removedAt: now() }, { lastUpdateTime: member.updateTime });
  }
  const pendingInviteRef = ref.collection("invites").doc(groupInviteId(groupId, targetUid));
  const invite = await pendingInviteRef.get();
  if (invite.exists && invite.data()?.status === "pending" && invite.updateTime) {
    await pendingInviteRef.update({ status: "revoked", updatedAt: now() }, { lastUpdateTime: invite.updateTime });
  }
  return { removed: true, uid: targetUid };
}

export async function leaveBookGroup({ db, groupId, uid, now = () => new Date().toISOString() }) {
  if (!validUid(uid)) throw new GroupMembershipInputError("A valid reader ID is required");
  const { ref, group } = await getGroup(db, groupId);
  if (group.ownerUid === uid) throw new GroupMembershipPermissionError("The owner must close the group instead of leaving");
  const memberRef = ref.collection("members").doc(uid);
  const member = await memberRef.get();
  if (!member.exists || member.data()?.status !== "active") return { left: false };
  await createRemovedMarker(ref, uid, now);
  if (member.updateTime) {
    await memberRef.update({ status: "left", leftAt: now() }, { lastUpdateTime: member.updateTime });
  }
  return { left: true };
}

export async function closeBookGroup({ db, groupId, ownerUid, now = () => new Date().toISOString() }) {
  const { ref, snapshot } = await requireOwner(db, groupId, ownerUid);
  if (!snapshot.updateTime) throw new GroupMembershipConflictError();
  try {
    await ref.update({ status: "closed", closedAt: now(), updatedAt: now() }, { lastUpdateTime: snapshot.updateTime });
    return { closed: true, groupId };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) throw new GroupMembershipConflictError();
    throw error;
  }
}


export async function joinPublicGroup({ db, groupId, uid, now = () => new Date().toISOString() }) {
  const { ref, group } = await getGroup(db, groupId);
  if (group.isPrivate === true) throw new GroupMembershipPermissionError("Private groups require an invitation");
  await requireVerifiedReader(db, uid);
  const [removed, memberSnapshot] = await Promise.all([
    ref.collection("removed").doc(uid).get(),
    ref.collection("members").doc(uid).get(),
  ]);
  if (removed.exists) throw new GroupMembershipPermissionError("You have been removed from this group");
  if (memberSnapshot.exists && memberSnapshot.data()?.status === "active") {
    return { joined: true, alreadyJoined: true };
  }
  const memberRef = ref.collection("members").doc(uid);
  const record = { uid, role: "member", status: "active", joinedAt: now(), schemaVersion: 1 };
  if (memberSnapshot.exists && memberSnapshot.updateTime) {
    await memberRef.update(record, { lastUpdateTime: memberSnapshot.updateTime });
  } else {
    await memberRef.create(record);
  }
  return { joined: true, alreadyJoined: false };
}

export async function listGroupRoster({ db, groupId, viewerUid }) {
  const { ref, group } = await getGroup(db, groupId);
  await requireVerifiedReader(db, viewerUid);
  const [memberSnapshot, removedSnapshot] = await Promise.all([
    ref.collection("members").doc(viewerUid).get(),
    ref.collection("removed").doc(viewerUid).get(),
  ]);
  const isOwner = group.ownerUid === viewerUid;
  if (removedSnapshot.exists || (!isOwner && (!memberSnapshot.exists || memberSnapshot.data()?.status !== "active"))) {
    throw new GroupMembershipPermissionError();
  }
  const memberPage = await ref.collection("members").limit(100).get();
  const memberDocs = memberPage.docs || [];
  if (memberDocs.length >= 100) throw new GroupMembershipConflictError("Group roster exceeds the safe display limit");
  const active = memberDocs
    .map((document) => ({ uid: document.id, ...document.data() }))
    .filter((member) => member.status === "active" && validUid(member.uid));
  const members = await Promise.all(active.map(async (member) => {
    const profile = await db.collection("users").doc(member.uid).get();
    const data = profile.exists ? profile.data() || {} : {};
    return {
      id: member.uid,
      name: typeof data.displayName === "string" && data.displayName.trim() ? data.displayName.slice(0, 80) : "Reader",
      role: member.role === "owner" ? "owner" : "member",
    };
  }));
  let pending = [];
  if (isOwner) {
    const invitePage = await ref.collection("invites").limit(100).get();
    const inviteDocs = invitePage.docs || [];
    if (inviteDocs.length >= 100) throw new GroupMembershipConflictError("Group invitation list exceeds the safe display limit");
    const invites = inviteDocs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((invite) => invite.status === "pending" && validUid(invite.inviteeUid));
    pending = await Promise.all(invites.map(async (invite) => {
      const profile = await db.collection("users").doc(invite.inviteeUid).get();
      const data = profile.exists ? profile.data() || {} : {};
      return {
        id: invite.inviteeUid,
        name: typeof data.displayName === "string" && data.displayName.trim() ? data.displayName.slice(0, 80) : "Reader",
      };
    }));
  }
  return { members, pending };
}
