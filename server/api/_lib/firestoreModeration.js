import { LibraryWriteConflictError } from "./firestoreLibraryWrites.js";

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/");
}
export class ModerationNotFoundError extends Error {
  constructor() { super("Moderation report not found"); this.name = "ModerationNotFoundError"; }
}
export class ModerationInputError extends Error {
  constructor(message) { super(message); this.name = "ModerationInputError"; }
}
export class ModerationConflictError extends Error {
  constructor() { super("Moderation report changed; reload and try again"); this.name = "ModerationConflictError"; }
}

function safeReport(document) {
  const row = document.data() || {};
  return {
    id: document.id,
    kind: row.kind,
    commentId: row.commentId,
    targetKind: row.targetKind,
    targetId: row.targetId,
    ownerUid: row.ownerUid,
    authorUid: row.authorUid,
    reporterUid: row.reporterUid,
    reason: typeof row.reason === "string" ? row.reason.slice(0, 500) : "",
    excerpt: typeof row.excerpt === "string" ? row.excerpt.slice(0, 400) : "",
    status: row.status,
    createdAt: row.createdAt || null,
    version: typeof document.updateTime === "string" ? document.updateTime : null,
  };
}

export async function listModerationReports({ db, limit = 50 }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ModerationInputError("Page size must be between 1 and 100");
  const snapshot = await db.collection("moderationReports").where("status", "==", "open").limit(101).get();
  const documents = snapshot.docs || [];
  if (documents.length > 100) throw new ModerationConflictError();
  const records = documents.map(safeReport)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, limit);
  return { count: records.length, records };
}

export async function resolveModerationReport({
  db, reportId, moderatorUid, action, expectedUpdateTime,
  now = () => new Date().toISOString(),
}) {
  if (!db || typeof db.commitWrites !== "function") throw new TypeError("An atomic Firestore client is required");
  if (!validId(reportId) || typeof moderatorUid !== "string" || !moderatorUid) {
    throw new ModerationInputError("A valid report and moderator are required");
  }
  if (!["dismiss", "hide_comment"].includes(action)) throw new ModerationInputError("Action must be dismiss or hide_comment");
  const reportRef = db.collection("moderationReports").doc(reportId);
  const reportSnapshot = await reportRef.get();
  if (!reportSnapshot.exists) throw new ModerationNotFoundError();
  if (!reportSnapshot.updateTime || reportSnapshot.updateTime !== expectedUpdateTime) {
    throw new ModerationConflictError();
  }
  const report = reportSnapshot.data() || {};
  if (report.status !== "open" || report.kind !== "comment" || !validId(report.commentId)) {
    throw new ModerationConflictError();
  }
  const timestamp = now();
  const writes = [];
  if (action === "hide_comment") {
    const commentRef = db.collection("comments").doc(report.commentId);
    const commentSnapshot = await commentRef.get();
    if (commentSnapshot.exists && commentSnapshot.data()?.status !== "deleted") {
      if (!commentSnapshot.updateTime) throw new ModerationConflictError();
      writes.push({
        type: "update",
        path: `comments/${report.commentId}`,
        updateTime: commentSnapshot.updateTime,
        data: { status: "deleted", body: "", deletedAt: timestamp, moderatedBy: moderatorUid },
      });
    }
  }
  writes.push({
    type: "update",
    path: `moderationReports/${reportId}`,
    updateTime: reportSnapshot.updateTime,
    data: {
      status: action === "hide_comment" ? "actioned" : "dismissed",
      action,
      reviewedBy: moderatorUid,
      reviewedAt: timestamp,
    },
  });
  try {
    await db.commitWrites(writes);
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new ModerationConflictError();
    }
    throw error;
  }
  return { id: reportId, status: action === "hide_comment" ? "actioned" : "dismissed", action };
}
