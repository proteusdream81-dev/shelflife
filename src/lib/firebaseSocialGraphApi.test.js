
import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseSocialGraphApi, FirebaseSocialGraphApiError } from "./firebaseSocialGraphApi.js";

function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("lists following and followers with verified Firebase auth", async () => {
  let call;
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { records: [{ readerUid: "readerB", displayName: "Reader B", status: "accepted" }] });
    },
  });
  const result = await api.listRelationships("following", { limit: 25 });
  assert.equal(result.records[0].displayName, "Reader B");
  assert.match(call.url, /direction=following/);
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
});

test("combines accepted followers/following and de-duplicates reader identities", async () => {
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async (url) => {
      const following = String(url).includes("direction=following");
      return response(200, { records: following ? [
        { readerUid: "readerB", displayName: "Reader B", status: "accepted" },
        { readerUid: "readerC", displayName: "Pending", status: "pending" },
      ] : [
        { readerUid: "readerB", displayName: "Reader B", status: "accepted" },
        { readerUid: "readerD", displayName: "Reader D", status: "accepted" },
      ] });
    },
  });
  assert.deepEqual(await api.listCircle(), [
    { id: "readerB", name: "Reader B" },
    { id: "readerD", name: "Reader D" },
  ]);
});

test("surfaces access errors and validates relationship direction", async () => {
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async () => response(403, { error: "Account migration is not complete" }),
  });
  await assert.rejects(api.listRelationships("followers"), (error) => {
    assert.ok(error instanceof FirebaseSocialGraphApiError);
    assert.equal(error.status, 403);
    return true;
  });
  await assert.rejects(api.listRelationships("blocked"), TypeError);
});

test("writes follow, accept, remove, block and unblock through the matching routes", async () => {
  const calls = [];
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { id: "a".repeat(64), status: "accepted", removed: true, blocked: true, unblocked: true });
    },
  });
  const relationshipId = "a".repeat(64);
  await api.followReader("readerB");
  await api.acceptFollowRequest(relationshipId);
  await api.removeFollowRelationship(relationshipId);
  await api.blockReader("readerC");
  await api.unblockReader("readerC");
  assert.equal(calls[0].url, "/api/relationships");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { followingUid: "readerB" });
  assert.equal(calls[1].url, `/api/relationships/${relationshipId}`);
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(calls[3].url, "/api/blocks");
  assert.deepEqual(JSON.parse(calls[3].options.body), { blockedUid: "readerC" });
  assert.equal(calls[4].url, "/api/blocks/readerC");
  assert.equal(calls[4].options.method, "DELETE");
});

test("rejects malformed relationship identifiers before network access", async () => {
  let calls = 0;
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async () => { calls += 1; return response(200, { records: [] }); },
  });
  await assert.rejects(api.acceptFollowRequest("not-a-hash"), TypeError);
  await assert.rejects(api.removeFollowRelationship("not-a-hash"), TypeError);
  assert.equal(calls, 0);
});

test("searches exact email or username through the server-side privacy projection", async () => {
  const calls = [];
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { readers: [{ id: "readerB", name: "Reader B", username: "readerb", shared_shelves: 1, state: "none" }] });
    },
  });
  const username = await api.searchReaders({ username: "@ReaderB" });
  const email = await api.searchReaders({ email: "READER@example.test" });
  const name = await api.searchReaders({ name: "  José   Smith " });
  assert.equal(calls[0].url, "/api/relationships?username=readerb");
  assert.equal(calls[1].url, "/api/relationships?email=reader%40example.test");
  assert.equal(calls[2].url, "/api/relationships?name=Jos%C3%A9+Smith");
  assert.equal(username.readers[0].id, "readerB");
  assert.equal(email.readers[0].state, "none");
  assert.equal(name.readers[0].id, "readerB");
  await assert.rejects(api.searchReaders({ username: "readerb", email: "reader@example.test" }), TypeError);
  await assert.rejects(api.searchReaders({ name: "Smith", username: "readerb" }), TypeError);
  await assert.rejects(api.searchReaders({ name: "x" }), TypeError);
  await assert.rejects(api.searchReaders({}), TypeError);
});

test("checks username availability through an authenticated privacy-safe endpoint", async () => {
  let call;
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { username: "reader_name", available: true });
    },
  });
  const result = await api.checkUsernameAvailability("@Reader_Name");
  assert.deepEqual(result, { username: "reader_name", available: true });
  assert.equal(call.url, "/api/relationships?checkUsername=reader_name");
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
});

test("rejects invalid username availability inputs before network access", async () => {
  let calls = 0;
  const api = createFirebaseSocialGraphApi({
    getToken: async () => "token",
    fetchImpl: async () => { calls += 1; return response(200, { username: "valid_name", available: true }); },
  });
  await assert.rejects(api.checkUsernameAvailability("bad.name"), TypeError);
  await assert.rejects(api.checkUsernameAvailability("ab"), TypeError);
  assert.equal(calls, 0);
});
