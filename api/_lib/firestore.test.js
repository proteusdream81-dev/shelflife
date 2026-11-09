import test from "node:test";
import assert from "node:assert/strict";
import { listUserBooks } from "./firestore.js";

function fakeDb(documents, capture) {
  const books = {
    limit(value) {
      capture.limit = value;
      return {
        async get() {
          return { docs: documents.map(({ id, data }) => ({ id, data: () => data })) };
        },
      };
    },
  };
  const user = {
    collection(name) {
      assert.equal(name, "books");
      return books;
    },
  };
  const users = {
    doc(uid) {
      capture.uid = uid;
      return user;
    },
  };
  return {
    collection(name) {
      assert.equal(name, "users");
      return users;
    },
  };
}

test("lists only the authenticated user's UID path and projects safe fields", async () => {
  const capture = {};
  const result = await listUserBooks({
    db: fakeDb([{ id: "book-1", data: { title: "Test Book", share_token: "private", status: "read" } }], capture),
    uid: "firebase-user-1",
  });
  assert.equal(capture.uid, "firebase-user-1");
  assert.equal(capture.limit, 50);
  assert.deepEqual(result, {
    count: 1,
    books: [{ id: "book-1", title: "Test Book", status: "read" }],
  });
});

test("caps page size at 50", async () => {
  const capture = {};
  await listUserBooks({ db: fakeDb([], capture), uid: "reader", limit: 500 });
  assert.equal(capture.limit, 50);
});

test("rejects UID path traversal", async () => {
  await assert.rejects(
    listUserBooks({ db: fakeDb([], {}), uid: "../other" }),
    /valid Firebase UID/,
  );
});

test("rejects invalid page sizes", async () => {
  await assert.rejects(
    listUserBooks({ db: fakeDb([], {}), uid: "reader", limit: 0 }),
    /Invalid page size/,
  );
});

test("never returns share tokens, legacy IDs or unapproved fields", async () => {
  const result = await listUserBooks({
    db: fakeDb([{
      id: "b",
      data: {
        title: "Private",
        share_token: "secret",
        shared_with_ids: ["x"],
        created_by_id: "base44-id",
        email: "x",
      },
    }], {}),
    uid: "reader",
  });
  assert.deepEqual(result.books[0], { id: "b", title: "Private" });
});
