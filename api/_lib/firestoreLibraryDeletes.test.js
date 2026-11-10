import test from "node:test";
import assert from "node:assert/strict";
import { deleteUserLibraryRecord } from "./firestoreLibraryDeletes.js";
import { LibraryWriteConflictError } from "./firestoreLibraryWrites.js";

function fakeDb({ collection, record, books = [], link = null } = {}) {
  const writes = [];
  return {
    writes,
    collection(name) {
      if (name === "users") return { doc(uid) {
        return { collection(child) {
          return {
            doc(id) {
              return {
                get: async () => ({
                  exists: child === collection && id === "item-1",
                  updateTime: "v1",
                  data: () => structuredClone(record),
                }),
              };
            },
            limit(maximum) {
              assert.equal(child, "books");
              assert.equal(maximum, 101);
              return { get: async () => ({ docs: books }) };
            },
          };
        } };
      } };
      if (name === "shareLinks") return { doc(id) { return { get: async () => ({
        exists: Boolean(link), updateTime: "link-v1", data: () => link,
      }) }; } };
      throw new Error("Unexpected collection " + name);
    },
    async commitWrites(batch) { writes.push(...batch); return { writeResults: [{ updateTime: "v2" }] }; },
  };
}

test("book deletion atomically disables sharing and records cover cleanup", async () => {
  const db = fakeDb({
    collection: "books",
    record: { title: "Book", shareEnabled: true, shareLinkId: "link-1", cover_storage_key: "readerA/cover.jpg" },
    link: { enabled: true },
  });
  const result = await deleteUserLibraryRecord({
    db, uid: "readerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.deleted, true);
  assert.equal(result.coverCleanupPending, true);
  assert.equal(db.writes.length, 2);
  assert.equal(db.writes[0].data.deletedAt, "2026-11-10T00:00:00Z");
  assert.equal(db.writes[0].data.shareEnabled, false);
  assert.equal(db.writes[1].path, "shareLinks/link-1");
  assert.equal(db.writes[1].data.enabled, false);
});

test("shelf deletion detaches all owned books in the same batch", async () => {
  const db = fakeDb({
    collection: "shelves",
    record: { name: "Fantasy", shareEnabled: true, shareLinkId: "link-1" },
    link: { enabled: true },
    books: [
      { id: "book-1", updateTime: "book-v1", data: () => ({ shelfIds: ["item-1", "other"] }) },
      { id: "book-2", updateTime: "book-v2", data: () => ({ shelfIds: ["item-1"] }) },
      { id: "book-3", updateTime: "book-v3", data: () => ({ shelfIds: ["other"] }) },
    ],
  });
  const result = await deleteUserLibraryRecord({
    db, uid: "readerA", collection: "shelves", id: "item-1", expectedUpdateTime: "v1",
    now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.detachedBookCount, 2);
  assert.equal(db.writes.length, 4);
  assert.deepEqual(db.writes[0].data.shelfIds, ["other"]);
  assert.deepEqual(db.writes[1].data.shelfIds, []);
  assert.equal(db.writes[2].data.deletedAt, "2026-11-10T00:00:00Z");
  assert.equal(db.writes[3].data.enabled, false);
});

test("stale versions fail without writing", async () => {
  const db = fakeDb({ collection: "books", record: { title: "Book" } });
  await assert.rejects(deleteUserLibraryRecord({
    db, uid: "readerA", collection: "books", id: "item-1", expectedUpdateTime: "old",
  }), LibraryWriteConflictError);
  assert.equal(db.writes.length, 0);
});
