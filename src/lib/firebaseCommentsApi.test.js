import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseCommentsApi, FirebaseCommentsApiError } from "./firebaseCommentsApi.js";

function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("lists comments for a specific shared target with authenticated requests", async () => {
  let call;
  const api = createFirebaseCommentsApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { records: [{ id: "comment-1", body: "hello" }] });
    },
  });
  const page = await api.listComments({ targetKind: "book", targetId: "book-1", ownerUid: "ownerA" });
  assert.equal(page.records[0].id, "comment-1");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
  assert.match(call.url, /targetKind=book/);
});

test("creates comments without allowing client author identity", async () => {
  let call;
  const api = createFirebaseCommentsApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(201, { id: "comment-1", authorUid: "readerA", body: "hello" });
    },
  });
  const result = await api.createComment({
    targetKind: "book", targetId: "book-1", ownerUid: "ownerA", body: "hello",
  });
  assert.equal(result.authorUid, "readerA");
  assert.deepEqual(JSON.parse(call.options.body), {
    targetKind: "book", targetId: "book-1", ownerUid: "ownerA", body: "hello",
  });
});

test("deletes and reports comments through separate owner-safe endpoints", async () => {
  const calls = [];
  const api = createFirebaseCommentsApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { ok: true }); },
  });
  await api.deleteComment("comment-1");
  await api.reportComment("comment-2", "Please review");
  assert.equal(calls[0].url, "/api/comments/comment-1");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[1].url, "/api/comments/comment-2/report");
  assert.deepEqual(JSON.parse(calls[1].options.body), { reason: "Please review" });
});

test("surfaces permissions and rejects malformed targets", async () => {
  const api = createFirebaseCommentsApi({
    getToken: async () => "token",
    fetchImpl: async () => response(403, { error: "You are not allowed to access this discussion" }),
  });
  await assert.rejects(api.listComments({ targetKind: "book", targetId: "book-1", ownerUid: "ownerA" }), (error) => {
    assert.ok(error instanceof FirebaseCommentsApiError);
    assert.equal(error.status, 403);
    return true;
  });
  await assert.rejects(api.listComments({ targetKind: "other", targetId: "book-1", ownerUid: "ownerA" }), TypeError);
});
