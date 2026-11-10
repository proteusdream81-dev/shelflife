import test from "node:test";
import assert from "node:assert/strict";
import { createGroupChatHandler } from "./groupChatHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;},
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true, displayName: "Firebase Name" } });

function dbFixture() {
  const messages = {};
  const groupRef = {
    get: async () => ({ exists: true, data: () => ({ ownerUid: "ownerA" }) }),
    collection(name) {
      if (name === "members") return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: "active" }) }) }) };
      if (name === "removed") return { doc: () => ({ get: async () => ({ exists: false }) }) };
      if (name === "messages") return {
        doc(id) {
          return {
            get: async () => ({ exists: !!messages[id], id, updateTime: "v1", data: () => messages[id] }),
            create: async (data) => { messages[id] = data; return { updateTime: "v2" }; },
          };
        },
        limit() { return { get: async () => ({ docs: Object.entries(messages).map(([id,data]) => ({ id, data: () => data })) }) }; },
      };
      throw new Error("Unexpected group subcollection");
    },
  };
  return { messages, collection: () => ({ doc: () => groupRef }) };
}

test("send route accepts only body text and derives author from verified identity", async () => {
  const res = response();
  const db = dbFixture();
  await createGroupChatHandler({
    operation: "send",
    verifyToken: auth,
    getDb: async () => db,
    resolveProfile: async () => ({ profile: { displayName: "Verified Reader" } }),
  })({ method: "POST", query: { id: "group-1" }, body: { body: "Hello" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.authorUid, "readerA");
  assert.equal(res.body.displayName, "Verified Reader");
  assert.equal(db.messages[res.body.id].body, "Hello");
});

test("send route rejects client-selected author fields", async () => {
  const res = response();
  await createGroupChatHandler({
    operation: "send",
    verifyToken: auth,
    getDb: async () => { throw new Error("Database should not be opened"); },
  })({ method: "POST", query: { id: "group-1" }, body: { body: "Hello", authorUid: "someone-else" } }, res);
  assert.equal(res.statusCode, 400);
});

test("requires a verified email and a migrated identity before group access", async () => {
  const res = response();
  let dbCalls = 0;
  await createGroupChatHandler({
    operation: "list",
    verifyToken: async () => ({ ok: true, user: { uid: "readerA", emailVerified: false } }),
    getDb: async () => { dbCalls += 1; return {}; },
  })({ method: "GET", query: { id: "group-1" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(dbCalls, 0);
});
