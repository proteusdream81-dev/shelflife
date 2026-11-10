import test from "node:test";
import assert from "node:assert/strict";
import { createCommentsHandler } from "./commentsHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("GET comment list derives the reader UID from verified Firebase auth", async () => {
  const res = response();
  let args;
  await createCommentsHandler({
    operation: "list", verifyToken: auth, getDb: async () => ({}),
    resolveProfile: async () => ({}),
    listComments: async (input) => { args = input; return { count: 0, records: [] }; },
  })({ method: "GET", query: { targetKind: "book", targetId: "book-1", ownerUid: "ownerA", uid: "attacker", cursor: "comment-cursor" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(args.uid, "readerA");
  assert.equal(args.cursor, "comment-cursor");
});

test("POST comment rejects client-selected author fields and returns server-created comment", async () => {
  const invalid = response();
  await createCommentsHandler({
    operation: "create", verifyToken: auth,
  })({ method: "POST", body: { targetKind: "book", targetId: "book-1", ownerUid: "ownerA", body: "hello", authorUid: "attacker" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const res = response();
  let args;
  await createCommentsHandler({
    operation: "create", verifyToken: auth, getDb: async () => ({}), resolveProfile: async () => ({}),
    createComment: async (input) => { args = input; return { id: "comment-1", authorUid: input.uid }; },
  })({ method: "POST", body: { targetKind: "book", targetId: "book-1", ownerUid: "ownerA", body: "hello" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(args.uid, "readerA");
});

test("POST report accepts only the reason field", async () => {
  const res = response();
  await createCommentsHandler({
    operation: "report", verifyToken: auth,
  })({ method: "POST", query: { id: "comment-1" }, body: { reason: "review", reporterUid: "attacker" } }, res);
  assert.equal(res.statusCode, 400);
});
