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
