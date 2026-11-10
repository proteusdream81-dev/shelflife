import { createHash, randomUUID } from "node:crypto";

const MAX_COMMENT_LENGTH = 2000;
function validUid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/");
}
function relationshipId(a, b) { return createHash("sha256").update(`${a}\0${b}`).digest("hex"); }

export class CommentInputError extends Error {
  constructor(message) { super(message); this.name = "CommentInputError"; }
}
export class CommentNotFoundError extends Error {
  constructor() { super("Comment or shared target not found"); this.name = "CommentNotFoundError"; }
}
export class CommentPermissionError extends Error {
  constructor(message = "You are not allowed to access this discussion") {
    super(message); this.name = "CommentPermissionError";
  }
}
export class CommentConflictError extends Error {
  constructor() { super("Comment changed; reload and try again"); this.name = "CommentConflictError"; }
}

async function requireVerifiedReader(db, uid) {
  if (!validUid(uid)) throw new CommentInputError("A valid reader account is required");
  const [profile, forward] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("identityLinks").doc(uid).get(),
  ]);
  const link = forward.exists ? forward.data() || {} : {};
  if (!profile.exists || link.status !== "verified" || !validUid(link.base44UserId)) {
    throw new CommentPermissionError("Reader account is not fully migrated");
  }
  const reverse = await db.collection("legacyIdentityLinks").doc(link.base44UserId).get();
  const row = reverse.exists ? reverse.data() || {} : {};
  if (row.status !== "verified" || row.firebaseUid !== uid) {
    throw new CommentPermissionError("Reader account identity is not verified");
  }
  const data = profile.data() || {};
  return {
    displayName: typeof data.displayName === "string" && data.displayName.trim()
      ? data.displayName.trim().slice(0, 80) : "Reader",
  };
}

async function canReadTarget({ db, targetKind, targetId, ownerUid, viewerUid }) {
  if (!["book", "shelf"].includes(targetKind) || !validId(targetId) ||
      !validUid(ownerUid) || !validUid(viewerUid)) throw new CommentInputError("A valid shared target is required");
  const collection = targetKind === "book" ? "books" : "shelves";
  if (ownerUid !== viewerUid) await requireVerifiedReader(db, ownerUid);
  const snapshot = await db.collection("users").doc(ownerUid).collection(collection).doc(targetId).get();
  if (!snapshot.exists) throw new CommentNotFoundError();
  if (ownerUid === viewerUid) return { snapshot, owner: true };
  const target = snapshot.data() || {};
  if (target.shareEnabled !== true || (targetKind === "shelf" && target.is_private === true)) {
    throw new CommentPermissionError();
  }
  const [forward, reverse, blockForward, blockReverse] = await Promise.all([
    db.collection("relationships").doc(relationshipId(ownerUid, viewerUid)).get(),
    db.collection("relationships").doc(relationshipId(viewerUid, ownerUid)).get(),
    db.collection("blocks").doc(relationshipId(ownerUid, viewerUid)).get(),
    db.collection("blocks").doc(relationshipId(viewerUid, ownerUid)).get(),
  ]);
  if (blockForward.exists || blockReverse.exists) throw new CommentPermissionError();
  const connected = [forward, reverse].some((item) => item.exists && item.data()?.status === "accepted");
  const selected = target.shareAudience === "selected" &&
    Array.isArray(target.sharedWithUids) && target.sharedWithUids.includes(viewerUid);
  if (!selected && !(target.shareAudience === "circle" && connected)) throw new CommentPermissionError();
  return { snapshot, owner: false };
}

function safeComment(document) {
  const source = document.data() || {};
  return {
    id: document.id,
    targetKind: source.targetKind,
    targetId: source.targetId,
    authorUid: source.authorUid,
    authorName: typeof source.authorName === "string" ? source.authorName.slice(0, 80) : "Reader",
    body: typeof source.body === "string" ? source.body.slice(0, MAX_COMMENT_LENGTH) : "",
    parentId: typeof source.parentId === "string" ? source.parentId : null,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : null,
    status: source.status === "deleted" ? "deleted" : "visible",
  };
}

export async function listComments({ db, uid, targetKind, targetId, ownerUid, limit = 50, cursor = null }) {
  await requireVerifiedReader(db, uid);
  await canReadTarget({ db, targetKind, targetId, ownerUid, viewerUid: uid });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CommentInputError("Page size must be between 1 and 100");
  if (cursor !== null && !validId(cursor)) throw new CommentInputError("Invalid comment cursor");
  let query = db.collection("comments").where("targetId", "==", targetId).limit(limit);
  if (cursor !== null) query = query.startAfter(cursor);
  const page = await query.get();
  const documents = page.docs || [];
  const records = documents
    .filter((document) => {
      const row = document.data() || {};
      return row.targetKind === targetKind && row.ownerUid === ownerUid && row.status !== "deleted";
    })
    .map(safeComment);
  return { targetKind, targetId, count: records.length, records, nextCursor: documents.length === limit ? documents[documents.length - 1]?.id || null : null };
}

export async function createComment({
  db, uid, ownerUid, targetKind, targetId, body, parentId = null,
  createId = randomUUID, now = () => new Date().toISOString(),
}) {
  const profile = await requireVerifiedReader(db, uid);
  await canReadTarget({ db, targetKind, targetId, ownerUid, viewerUid: uid });
  if (typeof body !== "string") throw new CommentInputError("Comment text is required");
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > MAX_COMMENT_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new CommentInputError("Comments must be 1 to 2000 characters");
  }
  let parent = null;
  if (parentId !== null) {
    if (!validId(parentId)) throw new CommentInputError("Invalid parent comment ID");
    const parentSnapshot = await db.collection("comments").doc(parentId).get();
    if (!parentSnapshot.exists) throw new CommentNotFoundError();
    parent = parentSnapshot.data() || {};
    if (parent.ownerUid !== ownerUid || parent.targetKind !== targetKind ||
        parent.targetId !== targetId || parent.status === "deleted") {
      throw new CommentInputError("Parent comment must belong to the same discussion");
    }
  }
  const id = createId();
  if (!validId(id)) throw new TypeError("Generated comment ID is invalid");
  const record = {
    targetKind, targetId, ownerUid, authorUid: uid, authorName: profile.displayName,
    body: normalized, parentId, createdAt: now(), status: "visible", schemaVersion: 1,
  };
  await db.collection("comments").doc(id).create(record);
  return { id, ...record };
}

export async function deleteComment({ db, uid, commentId, now = () => new Date().toISOString() }) {
  await requireVerifiedReader(db, uid);
  if (!validId(commentId)) throw new CommentInputError("A valid comment ID is required");
  const ref = db.collection("comments").doc(commentId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new CommentNotFoundError();
  const comment = snapshot.data() || {};
  if (comment.authorUid !== uid && comment.ownerUid !== uid) throw new CommentPermissionError();
  if (comment.status === "deleted") return { deleted: false, id: commentId };
  if (!snapshot.updateTime) throw new CommentConflictError();
  try {
    await ref.update({ status: "deleted", body: "", deletedAt: now() }, { lastUpdateTime: snapshot.updateTime });
    return { deleted: true, id: commentId };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) throw new CommentConflictError();
    throw error;
  }
}

export async function reportComment({ db, uid, commentId, reason, now = () => new Date().toISOString() }) {
  await requireVerifiedReader(db, uid);
  if (!validId(commentId)) throw new CommentInputError("A valid comment ID is required");
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    throw new CommentInputError("A report reason is required (maximum 500 characters)");
  }
  const commentSnapshot = await db.collection("comments").doc(commentId).get();
  if (!commentSnapshot.exists) throw new CommentNotFoundError();
  const comment = commentSnapshot.data() || {};
  if (comment.status === "deleted" || comment.authorUid === uid) throw new CommentPermissionError("This comment cannot be reported");
  await canReadTarget({
    db, targetKind: comment.targetKind, targetId: comment.targetId,
    ownerUid: comment.ownerUid, viewerUid: uid,
  });
  const id = createHash("sha256").update(`${commentId}\0${uid}`).digest("hex");
  const ref = db.collection("moderationReports").doc(id);
  const existing = await ref.get();
  if (existing.exists) return { id, status: "open", alreadyReported: true };
  try {
    await ref.create({
      kind: "comment", commentId, targetKind: comment.targetKind, targetId: comment.targetId,
      ownerUid: comment.ownerUid, authorUid: comment.authorUid, reporterUid: uid,
      reason: reason.trim(), excerpt: String(comment.body || "").slice(0, 400),
      status: "open", createdAt: now(), schemaVersion: 1,
    });
  } catch (error) {
    if (["ALREADY_EXISTS", 409].includes(error?.code)) return { id, status: "open", alreadyReported: true };
    throw error;
  }
  return { id, status: "open", alreadyReported: false };
}
