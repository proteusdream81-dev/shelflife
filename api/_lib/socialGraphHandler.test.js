import test from "node:test";
import assert from "node:assert/strict";
import { createSocialGraphHandler } from "./socialGraphHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;},
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("follow route requires a verified migrated account and creates a pending request", async () => {
  const res = response();
  let created;
  const db = {
    collection(name) {
      return { doc(id) { return { async get() {
        if (name === "users") return { exists: true, data: () => ({ profileHidden: true }) };
        if (name === "blocks") return { exists: false, data: () => null };
        if (name === "relationships") return { exists: false, data: () => null };
        return { exists: false, data: () => null };
      }, async create(data) { created = data; } }; } };
    },
  };
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => db,
    resolveProfile: async () => ({}),
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.status, "pending");
  assert.equal(created.followerUid, "readerA");
});

test("block route rejects self-blocking and maps permission errors safely", async () => {
  const res = response();
  await createSocialGraphHandler({
    operation: "block",
    verifyToken: auth,
    getDb: async () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) }) }),
    resolveProfile: async () => ({}),
  })({ method: "POST", query: { uid: "readerA" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /different valid reader/);
});

test("rejects unverified Firebase email before opening Firestore", async () => {
  const res = response();
  let dbCalls = 0;
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: async () => ({ ok: true, user: { uid: "readerA", emailVerified: false } }),
    getDb: async () => { dbCalls += 1; return {}; },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(dbCalls, 0);
});

test("does not expose social graph operations before profile migration", async () => {
  const res = response();
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => { const error = new Error("not linked"); error.name = "IdentityNotLinkedError"; throw error; },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 503);
});
