import test from "node:test";
import assert from "node:assert/strict";
import { createSharedWithMeHandler } from "./sharedWithMeHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("GET requires a verified Firebase session and migrated ShelfLife profile", async () => {
  const res = response();
  await createSharedWithMeHandler({
    verifyToken: async () => ({ ok: false, status: 401, error: "Missing token" }),
  })({ method: "GET" }, res);
  assert.equal(res.statusCode, 401);
});

test("returns the authenticated reader's shared feed without accepting a client UID", async () => {
  const res = response();
  let args;
  await createSharedWithMeHandler({
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async ({ firebaseUser }) => ({ uid: firebaseUser.uid }),
    listShares: async (input) => { args = input; return { count: 0, records: [] }; },
  })({ method: "GET", query: { uid: "attacker" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(args.uid, "readerA");
  assert.deepEqual(res.body, { count: 0, records: [] });
});
