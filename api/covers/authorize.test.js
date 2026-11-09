import test from "node:test";
import assert from "node:assert/strict";
import { createCoverAuthorizationHandler } from "./authorize.js";

const verifiedUser = {
  uid: "firebase-reader-1",
  email: "reader@example.test",
  emailVerified: true,
};

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createRequest({ method = "POST", body = { bookId: "book-123" } = {}) {
  return { method, body, headers: { authorization: "Bearer test-firebase-id-token" } };
}

test("cover authorization is POST-only and never caches authorization results", async () => {
  const res = mockResponse();
  const handler = createCoverAuthorizationHandler();
  await handler(createRequest({ method: "GET" }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers.Vary, "Authorization");
});

test("rejects an unauthenticated request before opening Firestore", async () => {
  let dbOpened = false;
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    getDb: async () => { dbOpened = true; throw new Error("must not run"); },
  });
  const res = mockResponse();
  await handler(createRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(dbOpened, false);
});

test("requires verified Firebase email before checking book ownership", async () => {
  let dbOpened = false;
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: { ...verifiedUser, emailVerified: false } }),
    getDb: async () => { dbOpened = true; throw new Error("must not run"); },
  });
  const res = mockResponse();
  await handler(createRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(dbOpened, false);
});

test("requires exactly one valid bookId and rejects caller-supplied owner fields", async () => {
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => { throw new Error("must not open database"); },
  });

  for (const body of [
    null,
    [],
    {},
    { bookId: "../other" },
    { bookId: "book/other" },
    { bookId: "book-123", uid: "attacker-uid" },
    { bookId: "book-123", ownerUid: "attacker-uid" },
  ]) {
    const res = mockResponse();
    await handler(createRequest({ body }), res);
    assert.equal(res.statusCode, 400);
  }
});

test("derives the Firestore owner path from the verified Firebase UID", async () => {
  const calls = [];
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => ({
      collection(name) {
        calls.push(["collection", name]);
        return {
          doc(id) {
            calls.push(["doc", id]);
            return {
              collection(subcollection) {
                calls.push(["collection", subcollection]);
                return {
                  doc(bookId) {
                    calls.push(["doc", bookId]);
                    return { get: async () => ({ exists: true }) };
                  },
                };
              },
            };
          },
        };
      },
    }),
  });
  const res = mockResponse();
  await handler(createRequest({ body: { bookId: "book-123" } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { authorized: true, bookId: "book-123" });
  assert.deepEqual(calls, [
    ["collection", "users"],
    ["doc", "firebase-reader-1"],
    ["collection", "books"],
    ["doc", "book-123"],
  ]);
});

test("denies a book that is not in the caller's own Firestore library", async () => {
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => ({
      collection() {
        return {
          doc() {
            return {
              collection() {
                return { doc: () => ({ get: async () => ({ exists: false }) }) };
              },
            };
          },
        };
      },
    }),
  });
  const res = mockResponse();
  await handler(createRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { authorized: false });
});

test("fails closed if Firestore authorization is unavailable", async () => {
  const handler = createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => { throw Object.assign(new Error("Firestore unavailable"), { code: 503 }); },
  });
  const res = mockResponse();
  await handler(createRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Book authorization service unavailable" });
});
