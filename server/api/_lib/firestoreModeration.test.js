import test from "node:test";
import assert from "node:assert/strict";
import {
  listModerationReports, resolveModerationReport,
  ModerationConflictError, ModerationInputError,
} from "./firestoreModeration.js";

function fakeDb({ report = {}, comment = null } = {}) {
  const writes = [];
  return {
    writes,
    collection(name) {
      if (name === "moderationReports" || name === "comments") return {
        doc(id) {
          const row = name === "moderationReports" ? report : comment;
          return {
            async get() { return { exists: Boolean(row), updateTime: "v1", data: () => structuredClone(row) }; },
          };
        },
        where(field, operator, value) {
          return { limit: () => ({ get: async () => ({
            docs: name === "moderationReports" && field === "status" && operator === "==" && value === "open" && report.status === "open"
              ? [{ id: "report-1", updateTime: "report-v1", data: () => structuredClone(report) }] : [],
          }) }) };
        },
      };
      throw new Error("Unexpected collection " + name);
    },
    async commitWrites(batch) { writes.push(...batch); return { writeResults: [] }; },
  };
}

test("lists only open moderation reports with a safe projection", async () => {
  const db = fakeDb({ report: {
    kind: "comment", commentId: "comment-1", targetKind: "book", targetId: "book-1",
    ownerUid: "ownerA", authorUid: "authorA", reporterUid: "readerA",
    reason: "Please review", excerpt: "reported text", status: "open", createdAt: "2026-11-10T00:00:00Z",
    privateEmail: "private@example.test",
  } });
  const result = await listModerationReports({ db });
  assert.equal(result.count, 1);
  assert.equal(result.records[0].commentId, "comment-1");
  assert.equal(result.records[0].version, "report-v1");
  assert.equal("privateEmail" in result.records[0], false);
});

test("hides a reported comment and resolves the report in one version-guarded commit", async () => {
  const db = fakeDb({
    report: { kind: "comment", commentId: "comment-1", status: "open" },
    comment: { status: "visible", body: "bad text" },
  });
  const result = await resolveModerationReport({
    db, reportId: "report-1", moderatorUid: "moderatorA",
    action: "hide_comment", expectedUpdateTime: "v1",
    now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.status, "actioned");
  assert.equal(db.writes.length, 2);
  assert.equal(db.writes[0].path, "comments/comment-1");
  assert.equal(db.writes[0].data.status, "deleted");
  assert.equal(db.writes[1].path, "moderationReports/report-1");
  assert.equal(db.writes[1].data.reviewedBy, "moderatorA");
});

test("rejects stale versions and unsupported actions", async () => {
  const db = fakeDb({ report: { kind: "comment", commentId: "comment-1", status: "open" } });
  await assert.rejects(resolveModerationReport({
    db, reportId: "report-1", moderatorUid: "moderatorA",
    action: "dismiss", expectedUpdateTime: "old",
  }), ModerationConflictError);
  await assert.rejects(resolveModerationReport({
    db, reportId: "report-1", moderatorUid: "moderatorA",
    action: "restore", expectedUpdateTime: "v1",
  }), ModerationInputError);
  assert.equal(db.writes.length, 0);
});
