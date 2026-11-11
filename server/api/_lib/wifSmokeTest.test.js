import test from "node:test";
import assert from "node:assert/strict";
import { createWifSmokeTestHandler } from "./wifSmokeTest.js";

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}
const verified = async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: true } });

test("creates, reads back and deletes only a generated document in the dev smoke collection", async () => {
  const calls = [];
  const data = new Map();
  const db = {
    projectId: "shelflife-tbr-dev",
    readOnly: false,
    collection(name) {
      assert.equal(name, "migrationSmokeTests");
      return { doc(id) {
        assert.match(id, /^smoke_[a-f0-9]+$/);
        return {
          async create(value) {
            calls.push("create");
            assert.equal(data.has(id), false);
            data.set(id, { value, updateTime: "2026-11-11T00:00:00.000Z" });
          },
          async get() {
            calls.push("get");
            const item = data.get(id);
            return item
              ? { exists: true, updateTime: item.updateTime, data: () => item.value }
              : { exists: false, updateTime: null, data: () => null };
          },
          async delete(options) {
            calls.push("delete");
            assert.equal(options.lastUpdateTime, "2026-11-11T00:00:00.000Z");
            data.delete(id);
          },
        };
      } };
    },
  };
  const res = response();
  await createWifSmokeTestHandler({
    verifyToken: verified,
    getDb: async () => db,
    createId: () => "a1b2-c3d4",
    now: () => "2026-11-11T00:00:00.000Z",
  })({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, projectId: "shelflife-tbr-dev", operation: "create-read-delete",
    readBackVerified: true, cleanupVerified: true,
  });
  assert.deepEqual(calls, ["create", "get", "delete", "get"]);
  assert.equal(data.size, 0);
});

test("rejects unauthenticated and unverified users before opening Firestore", async () => {
  let dbCalls = 0;
  const handler = createWifSmokeTestHandler({
    verifyToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    getDb: async () => { dbCalls += 1; return {}; },
  });
  const res = response();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(dbCalls, 0);
});

test("rejects non-verified Firebase email before opening Firestore", async () => {
  let dbCalls = 0;
  const res = response();
  await createWifSmokeTestHandler({
    verifyToken: async () => ({ ok: true, user: { uid: "reader", emailVerified: false } }),
    getDb: async () => { dbCalls += 1; return {}; },
  })({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(dbCalls, 0);
});

test("rejects caller-supplied payloads and non-POST methods", async () => {
  const handler = createWifSmokeTestHandler({ verifyToken: verified });
  const payload = response();
  await handler({ method: "POST", headers: {}, body: { collection: "users" } }, payload);
  assert.equal(payload.statusCode, 400);
  const method = response();
  await handler({ method: "GET", headers: {}, body: {} }, method);
  assert.equal(method.statusCode, 405);
});

test("refuses any database client that is not writable dev-only", async () => {
  const res = response();
  await createWifSmokeTestHandler({ verifyToken: verified, getDb: async () => ({ projectId: "shelflife-tbr-9754d", readOnly: false }) })({
    method: "POST", headers: {}, body: {},
  }, res);
  assert.equal(res.statusCode, 503);
});
