import test from "node:test";
import assert from "node:assert/strict";
import {
  updateUserBookCover,
  InvalidLibraryInputError,
  LibraryRecordNotFoundError,
  LibraryWriteConflictError,
} from "../_lib/firestoreLibraryWrites.js";
import { createLibraryCoverHandler } from "../_lib/libraryCoverHandler.js";
import { createCoverAuthorizationHandler } from "../covers/authorize.js";

function fakeDb(seed = {}, { failUpdate = false } = {}) {
  const records = new Map(Object.entries(seed));
  const calls = [];
  const key = (uid, collection, id) => `${uid}/${collection}/${id}`;
  return {
    records,
    calls,
    collection(root) {
      return {
        doc(uid) {
          return {
            collection(collectionName) {
              return {
                doc(id) {
                  return {
                    async get() {
                      const row = records.get(key(uid, collectionName, id));
                      return row
                        ? { exists: true, updateTime: row.updateTime, data: () => ({ ...row.data }) }
                        : { exists: false, updateTime: null, data: () => null };
                    },
                    async update(data, { lastUpdateTime } = {}) {
                      calls.push({ uid, collectionName, id, data, lastUpdateTime });
                      if (failUpdate) {
                        const error = new Error("stale");
                        error.code = "FAILED_PRECONDITION";
                        throw error;
                      }
                      const recordKey = key(uid, collectionName, id);
                      const row = records.get(recordKey);
                      if (!row || row.updateTime !== lastUpdateTime) {
                        const error = new Error("stale");
                        error.code = "FAILED_PRECONDITION";
                        throw error;
                      }
                      records.set(recordKey, {
                        data: { ...row.data, ...data },
                        updateTime: "2026-11-10T04:00:00.000Z",
                      });
                      return { updateTime: "2026-11-10T04:00:00.000Z" };
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

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const verified = async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: true } });
const oldVersion = "2026-11-10T03:00:00.000Z";
const key = "firebase-reader/550e8400-e29b-41d4-a716-446655440000.webp";

test("stores a valid UID-scoped cover key with Firestore updateTime precondition", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": {
      data: { title: "Book", cover_url: "https://old.example/cover.jpg" },
      updateTime: oldVersion,
    },
  });
  const record = await updateUserBookCover({
    db, uid: "firebase-reader", id: "book-1", objectKey: key,
    expectedUpdateTime: oldVersion, now: () => "2026-11-10T03:59:00.000Z",
  });
  assert.equal(db.calls[0].uid, "firebase-reader");
  assert.equal(db.calls[0].lastUpdateTime, oldVersion);
  assert.equal(db.calls[0].data.cover_storage_key, key);
  assert.equal(record.cover_storage_key, key);
  assert.equal(record.version, "2026-11-10T04:00:00.000Z");
});

test("rejects cross-owner, malformed, non-UUID and unsupported-extension cover keys", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": { data: { title: "Book" }, updateTime: oldVersion },
  });
  for (const objectKey of [
    "other-reader/550e8400-e29b-41d4-a716-446655440000.webp",
    "firebase-reader/../cover.webp",
    "firebase-reader/not-a-uuid.webp",
    "firebase-reader/550e8400-e29b-41d4-a716-446655440000.gif",
  ]) {
    await assert.rejects(
      updateUserBookCover({ db, uid: "firebase-reader", id: "book-1", objectKey, expectedUpdateTime: oldVersion }),
      InvalidLibraryInputError,
    );
  }
  assert.equal(db.calls.length, 0);
});

test("cover metadata updates are version-checked and owner-scoped", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": { data: { title: "Mine" }, updateTime: oldVersion },
    "other-reader/books/book-1": { data: { title: "Not mine" }, updateTime: oldVersion },
  });
  await updateUserBookCover({ db, uid: "firebase-reader", id: "book-1", objectKey: key, expectedUpdateTime: oldVersion });
  assert.equal(db.records.get("other-reader/books/book-1").data.cover_storage_key, undefined);
});

test("returns not found and conflict without changing a record", async () => {
  const missing = fakeDb();
  await assert.rejects(
    updateUserBookCover({ db: missing, uid: "firebase-reader", id: "missing", objectKey: key, expectedUpdateTime: oldVersion }),
    LibraryRecordNotFoundError,
  );
  const stale = fakeDb({
    "firebase-reader/books/book-1": { data: { title: "Book" }, updateTime: oldVersion },
  }, { failUpdate: true });
  await assert.rejects(
    updateUserBookCover({ db: stale, uid: "firebase-reader", id: "book-1", objectKey: key, expectedUpdateTime: oldVersion }),
    LibraryWriteConflictError,
  );
});

test("cover metadata route requires Firebase identity, verified migration profile and If-Match", async () => {
  let updateCalled = false;
  const handler = createLibraryCoverHandler({
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => ({ uid: "firebase-reader" }),
    updateCover: async () => { updateCalled = true; return { id: "book-1" }; },
  });
  const missingVersion = response();
  await handler({ method: "PUT", headers: {}, query: { id: "book-1" }, body: { objectKey: key } }, missingVersion);
  assert.equal(missingVersion.statusCode, 428);
  assert.equal(updateCalled, false);

  const success = response();
  await handler({
    method: "PUT",
    headers: { "if-match": oldVersion },
    query: { id: "book-1" },
    body: { objectKey: key },
  }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(updateCalled, true);
});

test("cover metadata route fails closed without verified legacy identity", async () => {
  const { IdentityNotLinkedError } = await import("../_lib/profile.js");
  let updateCalled = false;
  const res = response();
  const handler = createLibraryCoverHandler({
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
    updateCover: async () => { updateCalled = true; },
  });
  await handler({ method: "PUT", headers: { "if-match": oldVersion }, query: { id: "book-1" }, body: { objectKey: key } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(updateCalled, false);
});

test("cover authorization only exposes an allow/deny result for the authenticated owner", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": { data: { title: "Private title" }, updateTime: oldVersion },
  });
  const handler = createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => db,
    resolveProfile: async () => ({ uid: "firebase-reader" }),
  });
  const res = response();
  await handler({ method: "POST", body: { bookId: "book-1" }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { authorized: true, bookId: "book-1" });
  assert.equal("title" in res.body, false);
});

test("cover authorization rejects missing profile and cross-owner books", async () => {
  const { IdentityNotLinkedError } = await import("../_lib/profile.js");
  const unlinked = response();
  await createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => fakeDb(),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
  })({ method: "POST", body: { bookId: "book-1" }, headers: {} }, unlinked);
  assert.equal(unlinked.statusCode, 409);

  const crossOwner = response();
  await createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => fakeDb({
      "other-reader/books/book-1": { data: { title: "Not mine" }, updateTime: oldVersion },
    }),
    resolveProfile: async () => ({ uid: "firebase-reader" }),
  })({ method: "POST", body: { bookId: "book-1" }, headers: {} }, crossOwner);
  assert.equal(crossOwner.statusCode, 403);
});

test("cover authorization rejects extra client-selected authority fields", async () => {
  const res = response();
  await createCoverAuthorizationHandler({
    verifyToken: verified,
    getDb: async () => fakeDb(),
    resolveProfile: async () => ({ uid: "firebase-reader" }),
  })({ method: "POST", body: { bookId: "book-1", uid: "other-reader" }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
});
