import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryCollectionHandler } from "../_lib/ownedCollectionHandler.js";

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const goodAuth = async () => ({ ok: true, user: { uid: "verified-firebase-uid", emailVerified: true } });

test("uses the verified UID path and never a caller-supplied UID", async () => {
  const res = response();
  let received;
  const handler = createLibraryCollectionHandler({
    collection: "books",
    verifyToken: goodAuth,
    getDb: async () => ({}),
    listCollection: async (args) => {
      received = args;
      return { collection: "books", count: 1, records: [{ id: "b1" }], nextCursor: null };
    },
  });
  await handler({ method: "GET", headers: {}, query: { uid: "attacker", limit: "25" } }, res);
  assert.equal(received.uid, "verified-firebase-uid");
  assert.equal(received.limit, 25);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.count, 1);
});

test("rejects non-GET requests", async () => {
  const res = response();
  const handler = createLibraryCollectionHandler({ collection: "books", verifyToken: goodAuth });
  await handler({ method: "POST", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});

test("requires a valid Firebase identity and verified email", async () => {
  for (const verifyToken of [
    async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    async () => ({ ok: true, user: { uid: "reader", emailVerified: false } }),
  ]) {
    const res = response();
    const handler = createLibraryCollectionHandler({ collection: "books", verifyToken });
    await handler({ method: "GET", headers: {}, query: {} }, res);
    assert.notEqual(res.statusCode, 200);
  }
});

test("rejects invalid limits and cursors", async () => {
  for (const query of [{ limit: "0" }, { limit: "101" }, { cursor: "../other" }]) {
    const res = response();
    const handler = createLibraryCollectionHandler({ collection: "books", verifyToken: goodAuth });
    await handler({ method: "GET", headers: {}, query }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("fails closed when Firestore is unavailable", async () => {
  const res = response();
  const handler = createLibraryCollectionHandler({
    collection: "books",
    verifyToken: goodAuth,
    getDb: async () => { throw new Error("denied"); },
  });
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Library data service unavailable" });
});
