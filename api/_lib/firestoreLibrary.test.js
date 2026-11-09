import test from "node:test";
import assert from "node:assert/strict";
import { listUserLibraryCollection, validateLibraryLimit } from "./firestoreLibrary.js";

function fakeDb(rows, capture = {}) {
  return {
    capture,
    collection(name) {
      capture.rootCollection = name;
      return {
        doc(uid) {
          capture.uid = uid;
          return {
            collection(collectionName) {
              capture.collectionName = collectionName;
              return {
                limit(value) {
                  capture.limit = value;
                  return {
                    async get() {
                      return {
                        docs: rows.map(({ id, data }) => ({ id, data: () => data })),
                      };
                    },
                    startAfter(cursor) {
                      capture.cursor = cursor;
                      return {
                        async get() {
                          return {
                            docs: rows.map(({ id, data }) => ({ id, data: () => data })),
                          };
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
    },
  };
}

test("lists only the authenticated Firebase UID's books and projects approved owner fields", async () => {
  const db = fakeDb([{
    id: "book-1",
    data: {
      title: "Test Book",
      notes: "Private owner note",
      status: "read",
      share_token: "must-not-leave-storage",
      created_by_id: "legacy-base44-id",
      internalAudit: "hidden",
    },
  }]);
  const result = await listUserLibraryCollection({ db, uid: "firebase-user-1", collection: "books", limit: 50 });
  assert.equal(db.capture.rootCollection, "users");
  assert.equal(db.capture.uid, "firebase-user-1");
  assert.equal(db.capture.collectionName, "books");
  assert.deepEqual(result.records, [{
    title: "Test Book",
    notes: "Private owner note",
    status: "read",
    cover_storage_key: "firebase-user-1/550e8400-e29b-41d4-a716-446655440000.jpg",
    id: "book-1",
  }]);
  assert.equal(result.nextCursor, null);
});

test("shelves are scoped to the Firebase UID and exclude bearer tokens", async () => {
  const db = fakeDb([{
    id: "shelf-1",
    data: {
      name: "Favourites",
      is_private: true,
      share_token: "raw-token",
      unrelated: "hidden",
    },
  }]);
  const result = await listUserLibraryCollection({ db, uid: "firebase-user-2", collection: "shelves" });
  assert.deepEqual(result.records, [{ name: "Favourites", is_private: true, id: "shelf-1" }]);
  assert.equal(db.capture.uid, "firebase-user-2");
});

test("returns document-ID cursor for a full page and uses it on the next request", async () => {
  const db = fakeDb([{ id: "book-100", data: { title: "Last" } }]);
  const first = await listUserLibraryCollection({ db, uid: "reader", collection: "books", limit: 1 });
  assert.equal(first.nextCursor, "book-100");
  await listUserLibraryCollection({ db, uid: "reader", collection: "books", limit: 1, cursor: first.nextCursor });
  assert.equal(db.capture.cursor, "book-100");
});

test("rejects invalid UIDs, collections, limits and cursors before a query", async () => {
  const db = fakeDb([]);
  await assert.rejects(listUserLibraryCollection({ db, uid: "../other", collection: "books" }), /Firebase UID/);
  await assert.rejects(listUserLibraryCollection({ db, uid: "reader", collection: "Book" }), /Unsupported/);
  await assert.rejects(listUserLibraryCollection({ db, uid: "reader", collection: "books", limit: 101 }), /Limit/);
  await assert.rejects(listUserLibraryCollection({ db, uid: "reader", collection: "books", cursor: "../other" }), /cursor/);
  assert.equal(db.capture.rootCollection, undefined);
});

test("validates bounded limits", () => {
  assert.equal(validateLibraryLimit(1), true);
  assert.equal(validateLibraryLimit(100), true);
  assert.equal(validateLibraryLimit(0), false);
  assert.equal(validateLibraryLimit(101), false);
  assert.equal(validateLibraryLimit("10"), false);
});
