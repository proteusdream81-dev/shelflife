import test from "node:test";
import assert from "node:assert/strict";
import { createCoverAuthorizationHandler } from "./authorize.js";
import { IdentityNotLinkedError } from "../_lib/profile.js";

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const key = "firebase-reader/550e8400-e29b-41d4-a716-446655440000.webp";
function dbWithBook(coverKey = key) {
  return {
    collection(root) {
      assert.equal(root, "users");
      return {
        doc(uid) {
          assert.equal(uid, "firebase-reader");
          return {
            collection(name) {
              assert.equal(name, "books");
              return {
                doc(id) {
                  assert.equal(id, "book-1");
                  return {
                    async get() {
                      return coverKey === null
                        ? { exists: false, data: () => null }
                        : { exists: true, data: () => ({ cover_storage_key: coverKey }) };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const verified = async () => ({
  ok: true,
  user: { uid: "firebase-reader", emailVerified: true },
});

test("authorizes upload only for an existing book beneath the verified UID", async () => {
  const res = response();
  const handler = createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => dbWithBook(),
    resolveProfile: async () => ({}),
  });
  await handler({ method: "POST", headers: {}, body: { bookId: "book-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { authorized: true, bookId: "book-1" });
});

test("authorizes read only when the object key matches the book's stored cover pointer", async () => {
  const res = response();
  const handler = createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => dbWithBook(),
    resolveProfile: async () => ({}),
  });
  await handler({ method: "POST", headers: {}, body: { bookId: "book-1", objectKey: key } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { authorized: true, bookId: "book-1" });
});

test("denies a different owner key and a stale or mismatched cover pointer", async () => {
  for (const objectKey of [
    "another-reader/550e8400-e29b-41d4-a716-446655440000.webp",
    "firebase-reader/550e8400-e29b-41d4-a716-446655440001.webp",
  ]) {
    const res = response();
    const handler = createCoverAuthorizationHandler({
      verifyToken: verified,
      getDb: async () => dbWithBook(key),
      resolveProfile: async () => ({}),
    });
    await handler({ method: "POST", headers: {}, body: { bookId: "book-1", objectKey } }, res);
    assert.equal(res.statusCode, objectKey.startsWith("another-reader/") ? 400 : 403);
    if (objectKey.startsWith("another-reader/")) {
      assert.deepEqual(res.body, { error: "A valid bookId and optional owner cover key are required" });
    } else {
      assert.deepEqual(res.body, { authorized: false });
    }
  }
});

test("rejects arbitrary request fields and malformed object keys", async () => {
  for (const body of [
    { bookId: "book-1", objectKey: key, ownerUid: "other" },
    { bookId: "book-1", objectKey: "../private.jpg" },
    { bookId: "book-1", objectKey: "firebase-reader/not-a-uuid.webp" },
  ]) {
    const res = response();
    await createCoverAuthorizationHandler({
      verifyToken: verified,
      getDb: async () => dbWithBook(),
      resolveProfile: async () => ({}),
    })({ method: "POST", headers: {}, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("requires a verified identity link and migrated profile", async () => {
  const res = response();
  await createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
  })({ method: "POST", headers: {}, body: { bookId: "book-1" } }, res);
  assert.equal(res.statusCode, 409);
});

test("denies missing books and unverified email", async () => {
  const missing = response();
  await createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => dbWithBook(null),
    resolveProfile: async () => ({}),
  })({ method: "POST", headers: {}, body: { bookId: "book-1" } }, missing);
  assert.equal(missing.statusCode, 403);

  const unverified = response();
  await createCoverAuthorizationHandler({
    verifyToken: async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: false } }),
  })({ method: "POST", headers: {}, body: { bookId: "book-1" } }, unverified);
  assert.equal(unverified.statusCode, 403);
});
