import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseGroupChatApi, FirebaseGroupChatApiError } from "./firebaseGroupChatApi.js";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("lists paginated group messages with authenticated no-store requests", async () => {
  const calls = [];
  const api = createFirebaseGroupChatApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { groupId: "groupA", records: [{ id: "m1", body: "hello" }], nextCursor: null });
    },
  });
  const page = await api.listMessages("groupA", { limit: 25 });
  assert.equal(page.records[0].body, "hello");
  assert.equal(calls[0].options.headers.Authorization, "Bearer firebase-token");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].url, "/api/groups/groupA/messages?limit=25");
});

test("sends message body only and never accepts client author metadata", async () => {
  let call;
  const api = createFirebaseGroupChatApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(201, { id: "m1", authorUid: "readerA", body: "hello" });
    },
  });
  const result = await api.sendMessage("groupA", "hello");
  assert.equal(result.authorUid, "readerA");
  assert.equal(call.url, "/api/groups/groupA/messages");
  assert.deepEqual(JSON.parse(call.options.body), { body: "hello" });
});

test("deletes only the requested group message and surfaces API authorization errors", async () => {
  let call;
  const api = createFirebaseGroupChatApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(403, { error: "Only the group owner can remove chat messages" });
    },
  });
  await assert.rejects(api.deleteMessage("groupA", "m1"), (error) => {
    assert.ok(error instanceof FirebaseGroupChatApiError);
    assert.equal(error.status, 403);
    return true;
  });
  assert.equal(call.options.method, "DELETE");
  assert.equal(call.url, "/api/groups/groupA/messages/m1");
});

test("rejects malformed pagination and missing Firebase tokens", async () => {
  const api = createFirebaseGroupChatApi({ getToken: async () => null, fetchImpl: async () => { throw new Error("no fetch"); } });
  await assert.rejects(api.listMessages("groupA", { limit: 101 }), TypeError);
  await assert.rejects(api.listMessages("groupA"), (error) => error.status === 401);
});
