import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseGroupApi, FirebaseGroupApiError } from "./firebaseGroupApi.js";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

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

test("invites, responds and joins using the nested group routes", async () => {
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
  await api.joinPublicGroup("groupA");
  assert.equal(calls[0].url, "/api/groups/groupA/invites");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { inviteeUid: "readerB" });
  assert.equal(calls[1].url, "/api/groups/groupA/invites/inviteA");
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { decision: "accept" });
  assert.equal(calls[2].url, "/api/groups/groupA/join");
  assert.equal(calls[2].options.method, "POST");
});

test("roster reads, remove, leave and close use the implemented routes", async () => {
  const calls = [];
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { groupId: "groupA", members: [], pending: [] });
    },
  });
  const roster = await api.getGroupRoster("groupA");
  assert.deepEqual(roster.members, []);
  await api.removeReader("groupA", "readerB");
  await api.leaveGroup("groupA");
  await api.closeGroup("groupA");
  assert.equal(calls[0].url, "/api/groups/groupA/members");
  assert.equal(calls[1].url, "/api/groups/groupA/members/readerB");
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[2].url, "/api/groups/groupA/membership");
  assert.equal(calls[3].url, "/api/groups/groupA");
});

test("reads, sends and deletes chat messages through the group chat routes", async () => {
  const calls = [];
  const api = createFirebaseGroupApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { groupId: "groupA", records: [] });
    },
  });
  await api.listMessages("groupA", 25, "message-cursor");
  await api.sendMessage("groupA", "Hello group");
  await api.deleteMessage("groupA", "messageA");
  assert.match(calls[0].url, /limit=25/);
  assert.match(calls[0].url, /cursor=message-cursor/);
  assert.equal(calls[1].url, "/api/groups/groupA/messages");
  assert.deepEqual(JSON.parse(calls[1].options.body), { body: "Hello group" });
  assert.equal(calls[2].url, "/api/groups/groupA/messages/messageA");
  assert.equal(calls[2].options.method, "DELETE");
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
  await assert.rejects(api.sendMessage("groupA", " "), TypeError);
});
