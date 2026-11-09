import test from "node:test";
import assert from "node:assert/strict";
import { IdentityNotLinkedError, listOwnedRecords, validateOwnedEntity } from "./firestoreData.js";

function fakeDb({ link, records = [] }) {
  const calls = [];
  return {
    calls,
    collection(name) {
      calls.push(["collection", name]);
      if (name === "identityLinks") {
        return { doc(uid) { calls.push(["doc", uid]); return { async get() {
          return { exists: Boolean(link), data: () => link };
        } }; } };
      }
      return { where(field, operator, value) {
        calls.push(["where", field, operator, value]);
        return { limit(n) { calls.push(["limit", n]); return { async get() {
          return { docs: records.map((record) => ({ id: record.id, data: () => record.data })) };
        } }; } };
      } };
    },
  };
}

test("allowlist contains only owner-scoped migration collections", () => {
  assert.equal(validateOwnedEntity("Book"), true);
  assert.equal(validateOwnedEntity("Shelf"), true);
  assert.equal(validateOwnedEntity("Comment"), false);
  assert.equal(validateOwnedEntity("User"), false);
  assert.equal(validateOwnedEntity("../identityLinks"), false);
});

test("lists records only for the explicitly linked legacy user id", async () => {
  const db = fakeDb({
    link: { status: "verified", base44UserId: "legacy-user-7" },
    records: [{ id: "book-1", data: { title: "Example", created_by_id: "legacy-user-7" } }],
  });
  const result = await listOwnedRecords({ db, firebaseUid: "firebase-uid-1", entity: "Book", limit: 25 });
  assert.deepEqual(result, [{ id: "book-1", title: "Example", created_by_id: "legacy-user-7" }]);
  assert.deepEqual(db.calls, [
    ["collection", "identityLinks"],
    ["doc", "firebase-uid-1"],
    ["collection", "Book"],
    ["where", "created_by_id", "==", "legacy-user-7"],
    ["limit", 25],
  ]);
});

test("does not infer identity links from email or accept pending links", async () => {
  for (const link of [null, { email: "reader@example.test", base44UserId: "legacy-user-7" }, { status: "pending", base44UserId: "legacy-user-7" }]) {
    const db = fakeDb({ link });
    await assert.rejects(
      listOwnedRecords({ db, firebaseUid: "firebase-uid-1", entity: "Book" }),
      IdentityNotLinkedError,
    );
    assert.equal(db.calls.some((call) => call[0] === "where"), false);
  }
});

test("rejects arbitrary collections and unsafe limits before querying", async () => {
  const db = fakeDb({ link: { status: "verified", base44UserId: "legacy-user-7" } });
  await assert.rejects(listOwnedRecords({ db, firebaseUid: "uid", entity: "Comment" }), TypeError);
  await assert.rejects(listOwnedRecords({ db, firebaseUid: "uid", entity: "Book", limit: 101 }), TypeError);
  assert.equal(db.calls.length, 0);
});

test("Firestore document ID cannot be overridden by a legacy id field", async () => {
  const db = fakeDb({
    link: { status: "verified", base44UserId: "legacy-user-7" },
    records: [{ id: "firestore-book-1", data: { id: "spoofed-id", title: "Example", created_by_id: "legacy-user-7" } }],
  });
  const result = await listOwnedRecords({ db, firebaseUid: "firebase-uid-1", entity: "Book" });
  assert.equal(result[0].id, "firestore-book-1");
});
