import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createComment, deleteComment, listComments, reportComment,
  CommentInputError, CommentPermissionError,
} from "./firestoreComments.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fakeDb({ blocked = false, target = {} } = {}) {
  const identities = { ownerA: "legacy-ownerA", readerA: "legacy-readerA" };
  const state = {
    target: { shareEnabled: true, shareAudience: "selected", sharedWithUids: ["readerA"], is_private: false, ...target },
    comments: {},
    reports: {},
    version: 1,
  };
  const profile = (uid) => ({ displayName: uid === "readerA" ? "Reader A" : "Owner A" });
  return {
    state,
    collection(name) {
      if (name === "users") return { doc(uid) {
        return {
          get: async () => ({ exists: Boolean(identities[uid]), data: () => profile(uid) }),
          collection(collection) {
            return { doc(id) { return { get: async () => ({
              exists: collection === "books" && id === "book-1",
              updateTime: "target-v1",
              data: () => structuredClone(state.target),
            }) }; } };
          },
        };
      } };
      if (name === "identityLinks") return { doc(uid) { return { get: async () => ({
        exists: Boolean(identities[uid]), data: () => ({ status: "verified", base44UserId: identities[uid] }),
      }) }; } };
      if (name === "legacyIdentityLinks") return { doc(id) { return { get: async () => ({
        exists: Object.values(identities).includes(id),
        data: () => ({ status: "verified", firebaseUid: Object.keys(identities).find((uid) => identities[uid] === id) }),
      }) }; } };
      if (name === "relationships" || name === "blocks") return { doc(id) { return { get: async () => ({
        exists: name === "blocks" && blocked && id === hash("ownerA\0readerA"),
        data: () => ({ status: "accepted" }),
      }) }; } };
      if (name === "comments" || name === "moderationReports") {
        const bucket = name === "comments" ? state.comments : state.reports;
        return {
          doc(id) {
            return {
              async get() {
                const row = bucket[id];
                return { exists: Boolean(row), id, updateTime: row?._version || "v1", data: () => row && structuredClone(row) };
              },
              async create(data) {
                if (bucket[id]) { const error = new Error("exists"); error.code = "ALREADY_EXISTS"; throw error; }
                bucket[id] = { ...structuredClone(data), _version: "v1" };
                return { updateTime: "v1" };
              },
              async update(data, { lastUpdateTime } = {}) {
                if (!bucket[id] || bucket[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
                bucket[id] = { ...bucket[id], ...structuredClone(data), _version: "v2" };
                return { updateTime: "v2" };
              },
            };
          },
          where(field, operator, value) {
            return { limit(maximum) {
              const page = (cursor = null) => ({
                async get() {
                  const docs = Object.entries(bucket).filter(([id, row]) => row[field] === value && (cursor === null || id > cursor))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .slice(0, maximum).map(([id, row]) => ({
                      id, updateTime: row._version, data: () => structuredClone(row),
                    }));
                  return { docs };
                },
              });
              return { get: () => page().get(), startAfter: (cursor) => page(cursor) };
            } };
          },
        };
      }
      throw new Error("Unexpected collection " + name);
    },
  };
}

test("shared reader can list and create comments with server-derived author identity", async () => {
  const db = fakeDb();
  const created = await createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "  This is useful.  ", createId: () => "comment-1", now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(created.authorUid, "readerA");
  assert.equal(created.authorName, "Reader A");
  assert.equal(created.body, "This is useful.");
  const page = await listComments({ db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1" });
  assert.equal(page.count, 1);
  assert.equal(page.records[0].id, "comment-1");
});

test("selected share access survives leaving the circle but blocks deny access", async () => {
  const db = fakeDb();
  await createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "hello", createId: () => "comment-1",
  });
  const blocked = fakeDb({ blocked: true });
  await assert.rejects(listComments({
    db: blocked, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
  }), CommentPermissionError);
});

test("parent comments must belong to the same discussion and invalid content is rejected", async () => {
  const db = fakeDb();
  await createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "parent", createId: () => "parent-1",
  });
  const reply = await createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "reply", parentId: "parent-1", createId: () => "reply-1",
  });
  assert.equal(reply.parentId, "parent-1");
  await assert.rejects(createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1", body: " ",
  }), CommentInputError);
  await assert.rejects(createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1", body: "reply", parentId: "missing",
  }), /Comment or shared target not found/);
});

test("authors and target owners can soft-delete comments; others cannot", async () => {
  const db = fakeDb();
  await createComment({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "remove me", createId: () => "comment-1",
  });
  await assert.rejects(deleteComment({ db, uid: "readerB", commentId: "comment-1" }), CommentPermissionError);
  const ownerDb = fakeDb();
  ownerDb.state.comments["comment-1"] = {
    targetKind: "book", targetId: "book-1", ownerUid: "ownerA",
    authorUid: "readerA", body: "remove me", status: "visible", _version: "v1",
  };
  assert.deepEqual(await deleteComment({ db: ownerDb, uid: "ownerA", commentId: "comment-1" }), {
    deleted: true, id: "comment-1",
  });
  assert.equal(ownerDb.state.comments["comment-1"].status, "deleted");
  const thread = await listComments({ db: ownerDb, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1" });
  assert.equal(thread.records[0].body, "[Comment removed]");
  assert.equal(thread.records[0].status, "deleted");
});

test("comment reports are deduplicated per reader and exclude self-reports", async () => {
  const db = fakeDb();
  db.state.comments["comment-1"] = {
    ownerUid: "ownerA", authorUid: "ownerA", targetKind: "book", targetId: "book-1",
    body: "inappropriate", status: "visible", _version: "v1",
  };
  const first = await reportComment({ db, uid: "readerA", commentId: "comment-1", reason: "Please review" });
  const second = await reportComment({ db, uid: "readerA", commentId: "comment-1", reason: "Please review" });
  assert.equal(first.alreadyReported, false);
  assert.equal(second.alreadyReported, true);
  await assert.rejects(reportComment({ db, uid: "ownerA", commentId: "comment-1", reason: "self" }), CommentPermissionError);
});


test("comment lists paginate with a stable document-ID cursor", async () => {
  const db = fakeDb();
  for (const id of ["a", "b", "c"]) {
    db.state.comments[id] = {
      ownerUid: "ownerA", targetKind: "book", targetId: "book-1",
      authorUid: "readerA", authorName: "Reader A", body: id, status: "visible", _version: "v1",
    };
  }
  const first = await listComments({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1", limit: 2,
  });
  assert.deepEqual(first.records.map((row) => row.id), ["a", "b"]);
  assert.equal(first.nextCursor, "b");
  const second = await listComments({
    db, uid: "readerA", ownerUid: "ownerA", targetKind: "book", targetId: "book-1", limit: 2, cursor: first.nextCursor,
  });
  assert.deepEqual(second.records.map((row) => row.id), ["c"]);
  assert.equal(second.nextCursor, null);
});
