import test from "node:test";
import assert from "node:assert/strict";
import {
  createUserLibraryRecord,
  updateUserLibraryRecord,
  InvalidLibraryInputError,
  LibraryRecordNotFoundError,
  LibraryWriteConflictError,
} from "../_lib/firestoreLibraryWrites.js";
import { createLibraryWriteHandler } from "../_lib/libraryWriteHandler.js";

function fakeDb(seed = {}, { failUpdate = false } = {}) {
  const records = new Map(Object.entries(seed));
  const calls = [];
  const key = (uid, collection, id) => `${uid}/${collection}/${id}`;
  return {
    records,
    calls,
    collection(root) {
      assert.equal(root, "users");
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
                    async create(data) {
                      calls.push({ type: "create", uid, collectionName, id, data });
                      const recordKey = key(uid, collectionName, id);
                      if (records.has(recordKey)) {
                        const error = new Error("already exists");
                        error.code = "ALREADY_EXISTS";
                        throw error;
                      }
                      records.set(recordKey, {
                        data: { ...data },
                        updateTime: "2026-11-10T03:00:00.000Z",
                      });
                      return { updateTime: "2026-11-10T03:00:00.000Z" };
                    },
                    async update(data, { lastUpdateTime } = {}) {
                      calls.push({ type: "update", uid, collectionName, id, data, lastUpdateTime });
                      if (failUpdate) {
                        const error = new Error("stale");
                        error.code = "FAILED_PRECONDITION";
                        throw error;
                      }
                      const recordKey = key(uid, collectionName, id);
                      const row = records.get(recordKey);
                      if (!row) throw new Error("missing");
                      if (row.updateTime !== lastUpdateTime) {
                        const error = new Error("stale");
                        error.code = "FAILED_PRECONDITION";
                        throw error;
                      }
                      records.set(recordKey, {
                        data: { ...row.data, ...data },
                        updateTime: "2026-11-10T03:01:00.000Z",
                      });
                      return { updateTime: "2026-11-10T03:01:00.000Z" };
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
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const verified = async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: true } });

test("creates a book beneath the verified UID with server timestamps and defaults", async () => {
  const db = fakeDb();
  const record = await createUserLibraryRecord({
    db,
    uid: "firebase-reader",
    collection: "books",
    data: { title: "A New Book", shelfIds: [] },
    createId: () => "book-new",
    now: () => "2026-11-10T03:00:00.000Z",
  });
  assert.equal(db.calls[0].uid, "firebase-reader");
  assert.equal(db.calls[0].collectionName, "books");
  assert.equal(db.calls[0].id, "book-new");
  assert.equal(record.status, "to_read");
  assert.deepEqual(record.shelfIds, []);
  assert.equal(record.createdAt, "2026-11-10T03:00:00.000Z");
  assert.equal(record.updatedAt, record.createdAt);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.version, "2026-11-10T03:00:00.000Z");
  assert.equal("ownerUid" in record, false);
});

test("creates a shelf using only the verified UID path", async () => {
  const db = fakeDb();
  const record = await createUserLibraryRecord({
    db,
    uid: "firebase-reader",
    collection: "shelves",
    data: { name: "Favourites", is_private: true },
    createId: () => "shelf-new",
    now: () => "2026-11-10T03:00:00.000Z",
  });
  assert.equal(db.calls[0].collectionName, "shelves");
  assert.equal(db.calls[0].uid, "firebase-reader");
  assert.equal(record.name, "Favourites");
});

test("rejects client-selected ownership, IDs, role and server-managed fields", async () => {
  const db = fakeDb();
  for (const data of [
    { title: "Book", ownerUid: "victim" },
    { title: "Book", created_by_id: "legacy-id" },
    { title: "Book", id: "chosen-id" },
    { title: "Book", role: "admin" },
    { title: "Book", cover_storage_key: "someone-elses/key" },
    { title: "Book", sharedWithUids: ["victim"] },
    { title: "Book", share_enabled: true },
    { title: "Book", share_audience: "selected" },
  ]) {
    await assert.rejects(
      createUserLibraryRecord({ db, uid: "firebase-reader", collection: "books", data, createId: () => "x" }),
      InvalidLibraryInputError,
    );
  }
  assert.equal(db.calls.length, 0);
});

test("validates field types, bounds, HTTPS covers and duplicate shelf IDs", async () => {
  const db = fakeDb();
  const invalid = [
    { title: "Book", rating: 6 },
    { title: "Book", page_count: -1 },
    { title: "Book", cover_url: "javascript:alert(1)" },
    { title: "Book", shelfIds: ["shelf-a", "shelf-a"] },
    { title: "Book", share_audience: "everyone" },
  ];
  for (const data of invalid) {
    await assert.rejects(
      createUserLibraryRecord({ db, uid: "firebase-reader", collection: "books", data, createId: () => "x" }),
      InvalidLibraryInputError,
    );
  }
});

test("rejects shelf references that do not exist beneath the same Firebase UID", async () => {
  const db = fakeDb();
  await assert.rejects(
    createUserLibraryRecord({
      db, uid: "firebase-reader", collection: "books",
      data: { title: "Book", shelfIds: ["another-readers-shelf"] },
      createId: () => "book-1",
    }),
    /Every selected shelf must belong to this account/,
  );
  assert.equal(db.calls.length, 0);
});

test("updates only allowlisted fields with a last-read updateTime precondition", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": {
      data: { title: "Old", createdAt: "2026-01-01T00:00:00.000Z", notes: "Keep me" },
      updateTime: "2026-11-10T03:00:00.000Z",
    },
  });
  const updated = await updateUserLibraryRecord({
    db, uid: "firebase-reader", collection: "books", id: "book-1",
    data: { title: "New" },
    expectedUpdateTime: "2026-11-10T03:00:00.000Z",
    now: () => "2026-11-10T03:01:00.000Z",
  });
  const write = db.calls.find((call) => call.type === "update");
  assert.equal(write.uid, "firebase-reader");
  assert.equal(write.lastUpdateTime, "2026-11-10T03:00:00.000Z");
  assert.deepEqual(write.data, { title: "New", updatedAt: "2026-11-10T03:01:00.000Z" });
  assert.equal(updated.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(updated.notes, "Keep me");
  assert.equal(updated.title, "New");
  assert.equal(updated.version, "2026-11-10T03:01:00.000Z");
});

test("maps stale Firestore preconditions to a conflict", async () => {
  const db = fakeDb({
    "firebase-reader/shelves/shelf-1": {
      data: { name: "Old" },
      updateTime: "2026-11-10T03:00:00.000Z",
    },
  }, { failUpdate: true });
  await assert.rejects(
    updateUserLibraryRecord({ db, uid: "firebase-reader", collection: "shelves", id: "shelf-1", data: { name: "New" }, expectedUpdateTime: "2026-11-10T03:00:00.000Z" }),
    LibraryWriteConflictError,
  );
});

test("does not update a record outside the authenticated owner's subcollection", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": { data: { title: "Owned" }, updateTime: "2026-11-10T03:00:00.000Z" },
    "other-reader/books/book-1": { data: { title: "Not mine" }, updateTime: "2026-11-10T03:00:00.000Z" },
  });
  await updateUserLibraryRecord({
    db, uid: "firebase-reader", collection: "books", id: "book-1", data: { title: "Updated" }, expectedUpdateTime: "2026-11-10T03:00:00.000Z",
  });
  assert.equal(db.records.get("other-reader/books/book-1").data.title, "Not mine");
});

test("returns not found for a record outside the authenticated owner's library", async () => {
  const db = fakeDb({
    "other-reader/books/book-1": { data: { title: "Not mine" }, updateTime: "2026-11-10T03:00:00.000Z" },
  });
  await assert.rejects(
    updateUserLibraryRecord({
      db, uid: "firebase-reader", collection: "books", id: "book-1", data: { title: "Updated" }, expectedUpdateTime: "2026-11-10T03:00:00.000Z",
    }),
    LibraryRecordNotFoundError,
  );
});

test("write routes require the right method, Firebase identity and verified email", async () => {
  const handler = createLibraryWriteHandler({
    collection: "books",
    operation: "create",
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    createRecord: async () => ({ id: "book-1" }),
  });
  const wrongMethod = response();
  await handler({ method: "PATCH", headers: {}, body: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, "POST");

  const unverified = response();
  await createLibraryWriteHandler({
    collection: "books",
    operation: "create",
    verifyToken: async () => ({ ok: true, user: { uid: "reader", emailVerified: false } }),
  })({ method: "POST", headers: {}, body: { title: "Book" } }, unverified);
  assert.equal(unverified.statusCode, 403);

  const unauthorized = response();
  await createLibraryWriteHandler({
    collection: "books",
    operation: "create",
    verifyToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
  })({ method: "POST", headers: {}, body: { title: "Book" } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
});

test("write handler maps validation, not-found and concurrency errors to safe HTTP responses", async () => {
  for (const [error, expected] of [
    [new InvalidLibraryInputError("bad field"), 400],
    [new LibraryRecordNotFoundError(), 404],
    [new LibraryWriteConflictError(), 409],
  ]) {
    const res = response();
    const handler = createLibraryWriteHandler({
      collection: "books",
      operation: "update",
      verifyToken: verified,
      getDb: async () => ({}),
      resolveProfile: async () => ({}),
      updateRecord: async () => { throw error; },
    });
    await handler({ method: "PATCH", headers: { "if-match": "2026-11-10T03:00:00.000Z" }, query: { id: "book-1" }, body: { title: "Updated" } }, res);
    assert.equal(res.statusCode, expected);
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
});

test("rejects library writes until a verified identity link and migrated profile exist", async () => {
  const { IdentityNotLinkedError } = await import("../_lib/profile.js");
  let createCalled = false;
  const res = response();
  const handler = createLibraryWriteHandler({
    collection: "books",
    operation: "create",
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
    createRecord: async () => { createCalled = true; return { id: "book-1" }; },
  });
  await handler({ method: "POST", headers: {}, body: { title: "Book" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(createCalled, false);
  assert.deepEqual(res.body, { error: "Account migration is not complete" });
});

test("returns created records with HTTP 201 only after the identity gate passes", async () => {
  const res = response();
  const handler = createLibraryWriteHandler({
    collection: "shelves",
    operation: "create",
    verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => ({ uid: "firebase-reader" }),
    createRecord: async ({ uid, collection, data }) => ({ id: "shelf-1", uid, collection, ...data }),
  });
  await handler({ method: "POST", headers: {}, body: { name: "Favourites" } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.record, {
    id: "shelf-1", uid: "firebase-reader", collection: "shelves", name: "Favourites",
  });
});

test("update responses exclude migration metadata, roles and unknown stored fields", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": {
      data: {
        title: "Owned",
        createdAt: "2026-01-01T00:00:00.000Z",
        migration: { sourceId: "legacy-book" },
        role: "admin",
        internalAudit: "private",
      },
      updateTime: "2026-11-10T03:00:00.000Z",
    },
  });
  const updated = await updateUserLibraryRecord({
    db, uid: "firebase-reader", collection: "books", id: "book-1",
    data: { notes: "Updated" },
    expectedUpdateTime: "2026-11-10T03:00:00.000Z",
    now: () => "2026-11-10T03:01:00.000Z",
  });
  assert.equal(updated.title, "Owned");
  assert.equal(updated.notes, "Updated");
  assert.equal("migration" in updated, false);
  assert.equal("role" in updated, false);
  assert.equal("internalAudit" in updated, false);
});

test("rejects updates without a client If-Match version", async () => {
  let getDbCalled = false;
  const res = response();
  const handler = createLibraryWriteHandler({
    collection: "books",
    operation: "update",
    verifyToken: verified,
    getDb: async () => { getDbCalled = true; return {}; },
    resolveProfile: async () => ({}),
  });
  await handler({ method: "PATCH", headers: {}, query: { id: "book-1" }, body: { title: "Updated" } }, res);
  assert.equal(res.statusCode, 428);
  assert.equal(getDbCalled, false);
});

test("rejects a stale client version before writing", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-1": {
      data: { title: "Changed elsewhere" },
      updateTime: "2026-11-10T03:02:00.000Z",
    },
  });
  await assert.rejects(
    updateUserLibraryRecord({
      db, uid: "firebase-reader", collection: "books", id: "book-1",
      data: { title: "Stale edit" },
      expectedUpdateTime: "2026-11-10T03:00:00.000Z",
    }),
    LibraryWriteConflictError,
  );
  assert.equal(db.calls.some((call) => call.type === "update"), false);
});

test("create collisions fail closed instead of overwriting an existing record", async () => {
  const db = fakeDb({
    "firebase-reader/books/book-new": {
      data: { title: "Existing" },
      updateTime: "2026-11-10T03:00:00.000Z",
    },
  });
  await assert.rejects(
    createUserLibraryRecord({
      db, uid: "firebase-reader", collection: "books",
      data: { title: "Attempted overwrite" },
      createId: () => "book-new",
    }),
    LibraryWriteConflictError,
  );
  assert.equal(db.records.get("firebase-reader/books/book-new").data.title, "Existing");
});


test("DELETE requires If-Match and delegates owner-scoped soft deletion", async () => {
  const missing = response();
  await createLibraryWriteHandler({
    collection: "books", operation: "delete", verifyToken: verified,
  })({ method: "DELETE", query: { id: "book-1" }, headers: {} }, missing);
  assert.equal(missing.statusCode, 428);

  const res = response();
  let args;
  await createLibraryWriteHandler({
    collection: "shelves", operation: "delete", verifyToken: verified,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    deleteRecord: async (input) => { args = input; return { id: input.id, deleted: true }; },
  })({
    method: "DELETE", query: { id: "shelf-1" }, headers: { "if-match": "v1" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(args.uid, "firebase-reader");
  assert.equal(args.collection, "shelves");
  assert.equal(args.expectedUpdateTime, "v1");
  assert.deepEqual(res.body, { id: "shelf-1", deleted: true });
});


test("deletes the private R2 cover after book tombstoning and does not expose its object key", async () => {
  const res = response();
  let cleanupArgs;
  let metadataWrites;
  await createLibraryWriteHandler({
    collection: "books", operation: "delete", verifyToken: verified,
    getDb: async () => ({
      commitWrites: async (writes) => { metadataWrites = writes; return { writeResults: [{ updateTime: "v3" }] }; },
    }),
    resolveProfile: async () => ({}),
    deleteRecord: async () => ({
      id: "book-1", collection: "books", deleted: true,
      coverCleanupPending: true,
      coverObjectKey: "firebase-reader/123e4567-e89b-42d3-a456-426614174000.jpg",
      coverUpdateTime: "v2",
    }),
    deleteCover: async (input) => { cleanupArgs = input; return true; },
  })({
    method: "DELETE", query: { id: "book-1" }, headers: {
      "if-match": "v1", authorization: "Bearer firebase-token",
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(cleanupArgs.uid, "firebase-reader");
  assert.equal(cleanupArgs.bearerToken, "firebase-token");
  assert.equal(metadataWrites[0].data.cover_storage_key, null);
  assert.equal(metadataWrites[0].data.coverCleanupPending, false);
  assert.equal(res.body.coverCleanupPending, false);
  assert.equal("coverObjectKey" in res.body, false);
});
