import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseGroupApi, FirebaseGroupApiError } from "./firebaseGroupApi.js";

function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("lists only the requested group scope with a Firebase bearer token", async () => {
  let call;
  const api = createFirebaseGroupApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { scope: "mine", records: [], nextCursor: null });
    },
  });
  const result = await api.listGroups({ scope: "mine", limit: 25 });
  assert.deepEqual(result.records, []);
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
  assert.equal(call.options.cache, "no-store");
  assert.match(call.url, /scope=mine/);
});

test("creates groups without injecting owner identity", async () => {
  let call;
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(201, { id: "groupA", ownerUid: "readerA", name: "Fantasy" });
    },
  });
  const group = await api.createGroup({ name: "Fantasy", isPrivate: true });
  assert.equal(group.ownerUid, "readerA");
  assert.deepEqual(JSON.parse(call.options.body), { name: "Fantasy", isPrivate: true });
});

test("invites and responds using explicit group and invite IDs", async () => {
  const calls = [];
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { status: "pending" });
    },
  });
  await api.inviteReader("groupA", "readerB");
  await api.respondToInvite("groupA", "inviteA", "accept");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { inviteeUid: "readerB" });
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { decision: "accept" });
});

test("remove, leave and close target the requested group membership operation", async () => {
  const calls = [];
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { ok: true }); },
  });
  await api.removeReader("groupA", "readerB");
  await api.leaveGroup("groupA");
  await api.closeGroup("groupA");
  assert.equal(calls[0].options.method, "DELETE");
  assert.match(calls[0].url, /uid=readerB/);
  assert.match(calls[1].url, /action=leave/);
  assert.match(calls[2].url, /action=close/);
});

test("surfaces authorization errors and rejects malformed inputs", async () => {
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async () => response(403, { error: "Only the owner can invite" }),
  });
  await assert.rejects(api.inviteReader("groupA", "readerB"), (error) => {
    assert.ok(error instanceof FirebaseGroupApiError);
    assert.equal(error.status, 403);
    return true;
  });
  await assert.rejects(api.listGroups({ scope: "all" }), TypeError);
  await assert.rejects(api.respondToInvite("groupA", "inviteA", "maybe"), TypeError);
});
