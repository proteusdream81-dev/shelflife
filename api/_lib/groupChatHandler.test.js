import test from "node:test";
import assert from "node:assert/strict";
import { createGroupChatHandler } from "./groupChatHandler.js";
import { IdentityNotLinkedError } from "./profile.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;},
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true, displayName: "Reader A" } });
const profile = async () => ({ profile: { displayName: "Reader A" } });

function dbFixture() {
  const records = {};
  const groupRef = {
    async get() { return { exists: true, data: () => ({ ownerUid: "owner" }) }; },
    collection(name) {
      if (name === "members" || name === "removed") return { doc(uid) {
        return { get: async () => ({ exists: name === "members" && uid === "readerA", data: () => ({ status: "active" }) }) };
      } };
      if (name === "messages") return {
        doc(id) { return { async create(data) { records[id] = data; return { updateTime: "version" }; } }; },
        limit() { return { get: async () => ({ docs: Object.entries(records).map(([id,data]) => ({ id, data: () => data })) }) }; },
      };
      throw new Error("Unexpected collection");
    },
  };
  return { records, collection(name) { assert.equal(name, "groups"); return { doc(id) { assert.equal(id, "groupA"); return groupRef; } }; } };
}

test("GET lists group messages for a verified active member", async () => {
  const res = response();
  const db = dbFixture();
  await createGroupChatHandler({
    operation: "list", verifyToken: auth, getDb: async () => db, resolveProfile: profile,
  })({ method: "GET", query: { groupId: "groupA" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.groupId, "groupA");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("POST creates a message using the authenticated UID and trusted profile name", async () => {
  const res = response();
  const db = dbFixture();
  await createGroupChatHandler({
    operation: "create", verifyToken: auth, getDb: async () => db, resolveProfile: profile,
  })({ method: "POST", body: { groupId: "groupA", body: "hello" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.authorUid, "readerA");
  assert.equal(res.body.displayName, "Reader A");
  assert.equal(db.records[res.body.id].body, "hello");
});

test("POST rejects client-supplied author identity and blocks unverified email", async () => {
  const res = response();
  await createGroupChatHandler({
    operation: "create", verifyToken: auth, getDb: async () => dbFixture(), resolveProfile: profile,
  })({ method: "POST", body: { groupId: "groupA", body: "hello", authorUid: "owner" } }, res);
  assert.equal(res.statusCode, 400);
  const denied = response();
  await createGroupChatHandler({
    operation: "create",
    verifyToken: async () => ({ ok: true, user: { uid: "readerA", emailVerified: false } }),
    getDb: async () => { throw new Error("must not open database"); },
  })({ method: "POST", body: { groupId: "groupA", body: "hello" } }, denied);
  assert.equal(denied.statusCode, 403);
});

test("does not serve group chat until account identity and profile are migrated", async () => {
  const res = response();
  await createGroupChatHandler({
    operation: "list", verifyToken: auth, getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
  })({ method: "GET", query: { groupId: "groupA" } }, res);
  assert.equal(res.statusCode, 409);
});
