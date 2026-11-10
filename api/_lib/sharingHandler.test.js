import test from "node:test";
import assert from "node:assert/strict";
import { createSharingHandler } from "./sharingHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("PATCH requires auth, verified email and an If-Match version", async () => {
  const noAuth = response();
  await createSharingHandler({
    collection: "books", verifyToken: async () => ({ ok: false, status: 401, error: "Missing token" }),
  })({ method: "PATCH", query: { id: "book-1" }, headers: {} }, noAuth);
  assert.equal(noAuth.statusCode, 401);
  const unverified = response();
  await createSharingHandler({
    collection: "books",
    verifyToken: async () => ({ ok: true, user: { uid: "readerA", emailVerified: false } }),
  })({ method: "PATCH", query: { id: "book-1" }, headers: { "if-match": "v1" } }, unverified);
  assert.equal(unverified.statusCode, 403);
  const missingVersion = response();
  await createSharingHandler({ collection: "books", verifyToken: auth })({
    method: "PATCH", query: { id: "book-1" }, headers: {},
  }, missingVersion);
  assert.equal(missingVersion.statusCode, 428);
});

test("PATCH resolves migrated identity and delegates owner-scoped sharing settings", async () => {
  const res = response();
  let args;
  await createSharingHandler({
    collection: "shelves",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async ({ firebaseUser }) => ({ uid: firebaseUser.uid }),
    updateSettings: async (input) => { args = input; return { shareEnabled: true, shareAudience: "circle" }; },
  })({
    method: "PATCH", query: { id: "shelf-1" }, headers: { "if-match": "v1" },
    body: { enabled: true, audience: "circle", recipientUids: [], linkEnabled: false },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(args.collection, "shelves");
  assert.equal(args.uid, "readerA");
  assert.equal(args.expectedUpdateTime, "v1");
});

test("rejects unknown library record IDs before database access", async () => {
  const res = response();
  await createSharingHandler({
    collection: "books", verifyToken: auth, getDb: async () => { throw new Error("must not open DB"); },
  })({ method: "PATCH", query: {}, headers: { "if-match": "v1" } }, res);
  assert.equal(res.statusCode, 400);
});
