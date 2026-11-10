import { randomUUID } from "node:crypto";

function validDocumentId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}

export class GroupChatInputError extends Error {
  constructor(message) { super(message); this.name = "GroupChatInputError"; }
}
export class GroupChatNotFoundError extends Error {
  constructor() { super("Group or message not found"); this.name = "GroupChatNotFoundError"; }
}
export class GroupChatPermissionError extends Error {
  constructor(message = "You are not an active member of this group") {
    super(message); this.name = "GroupChatPermissionError";
  }
}
export class GroupChatConflictError extends Error {
  constructor() { super("This message changed; refresh and try again"); this.name = "GroupChatConflictError"; }
}

async function getGroupAccess({ db, groupId, uid }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validDocumentId(groupId) || !validDocumentId(uid)) {
    throw new GroupChatInputError("A valid group ID is required");
  }
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnapshot = await groupRef.get();
  if (!groupSnapshot.exists) throw new GroupChatNotFoundError();
  const group = groupSnapshot.data() || {};
  if (group.status === "closed") throw new GroupChatNotFoundError();
  const [memberSnapshot, removedSnapshot] = await Promise.all([
    groupRef.collection("members").doc(uid).get(),
    groupRef.collection("removed").doc(uid).get(),
  ]);
  if (removedSnapshot.exists && removedSnapshot.data()?.reason !== "rejoined") throw new GroupChatPermissionError("You have been removed from this group");
  const member = memberSnapshot.exists ? memberSnapshot.data() || {} : null;
  const isOwner = group.ownerUid === uid;
  if (!isOwner && (!member || member.status !== "active")) throw new GroupChatPermissionError();
  return { groupRef, group, groupSnapshot, isOwner, member };
}

export async function listGroupMessages({ db, groupId, uid, limit = 50, cursor = null }) {
  const { groupRef } = await getGroupAccess({ db, groupId, uid });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new GroupChatInputError("Page size must be between 1 and 100");
  }
  if (cursor !== null && !validDocumentId(cursor)) throw new GroupChatInputError("Invalid message cursor");
  let query = groupRef.collection("messages").limit(limit);
  if (cursor !== null) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const documents = snapshot.docs || [];
  const records = documents.map((document) => {
    const source = document.data() || {};
    return {
      id: document.id,
      authorUid: typeof source.authorUid === "string" ? source.authorUid : "",
      displayName: typeof source.displayName === "string" ? source.displayName.slice(0, 80) : "Reader",
      body: typeof source.body === "string" ? source.body.slice(0, 1000) : "",
      createdAt: typeof source.createdAt === "string" ? source.createdAt : null,
    };
  }).filter((record) => record.authorUid && record.body);
  return {
    groupId,
    count: records.length,
    records,
    nextCursor: documents.length === limit ? documents[documents.length - 1]?.id || null : null,
  };
}

export async function createGroupMessage({
  db, groupId, uid, displayName, body, createId = randomUUID, now = () => new Date().toISOString(),
}) {
  const { groupRef } = await getGroupAccess({ db, groupId, uid });
  if (typeof body !== "string") throw new GroupChatInputError("A message is required");
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new GroupChatInputError("Messages must be 1 to 1000 characters");
  }
  const id = createId();
  if (!validDocumentId(id)) throw new TypeError("Generated message ID is invalid");
  const record = {
    authorUid: uid,
    displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 80) : "Reader",
    body: normalized,
    createdAt: now(),
    schemaVersion: 1,
  };
  let created;
  try {
    created = await groupRef.collection("messages").doc(id).create(record);
  } catch (error) {
    if (["ALREADY_EXISTS", 409].includes(error?.code)) throw new GroupChatConflictError();
    throw error;
  }
  return { id, ...record, version: created?.updateTime || null };
}

export async function deleteGroupMessage({ db, groupId, uid, messageId }) {
  const { groupRef, isOwner } = await getGroupAccess({ db, groupId, uid });
  if (!isOwner) throw new GroupChatPermissionError("Only the group owner can remove chat messages");
  if (!validDocumentId(messageId)) throw new GroupChatInputError("A valid message ID is required");
  const ref = groupRef.collection("messages").doc(messageId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new GroupChatNotFoundError();
  if (!snapshot.updateTime) throw new GroupChatConflictError();
  try {
    await ref.delete({ lastUpdateTime: snapshot.updateTime });
    return { deleted: true, id: messageId };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new GroupChatConflictError();
    }
    if (["NOT_FOUND", 404].includes(error?.code)) return { deleted: false, id: messageId };
    throw error;
  }
}
