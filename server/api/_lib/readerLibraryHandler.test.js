import test from "node:test";
import assert from "node:assert/strict";
import { createReaderLibraryHandler } from "./readerLibraryHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("shared reader library requires a verified Firebase session", async () => {
  const res = response();
  await createReaderLibraryHandler({ verifyToken: async () => ({ ok: false, status: 401, error: "Missing token" }) })(
    { method: "GET", query: { uid: "readerB" } }, res,
  );
  assert.equal(res.statusCode, 401);
});

test("uses the authenticated viewer and path reader ID, never a client-supplied viewer ID", async () => {
  const res = response();
  let args;
  await createReaderLibraryHandler({
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async () => true,
    listLibrary: async (input) => { args = input; return { ownerName: "Reader B", covers_hidden: false, shelves: [], shared_books: [] }; },
  })({ method: "GET", query: { uid: "readerB", viewerUid: "attacker" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(args.viewerUid, "readerA");
  assert.equal(args.readerUid, "readerB");
  assert.equal(res.body.ownerName, "Reader B");
});

test("rate limits shared reader library reads before loading records", async () => {
  const res = response();
  let called = false;
  await createReaderLibraryHandler({
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async () => false,
    listLibrary: async () => { called = true; return {}; },
  })({ method: "GET", query: { uid: "readerB" } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(called, false);
});

test("rejects unsupported methods and missing reader IDs", async () => {
  const handler = createReaderLibraryHandler({ verifyToken: auth });
  const methodRes = response();
  await handler({ method: "POST", query: { uid: "readerB" } }, methodRes);
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.Allow, "GET");
  const idRes = response();
  await handler({ method: "GET", query: {} }, idRes);
  assert.equal(idRes.statusCode, 400);
});
