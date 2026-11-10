import test from "node:test";
import assert from "node:assert/strict";
import { createFirestoreRestClient } from "./firestoreRest.js";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("reads a verified identity-link document through Firestore REST", async () => {
  const calls = [];
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        name: "projects/shelflife-tbr-9754d/databases/(default)/documents/identityLinks/firebase-uid",
        fields: { status: { stringValue: "verified" }, base44UserId: { stringValue: "legacy-user" } },
      });
    },
  });
  const snapshot = await db.collection("identityLinks").doc("firebase-uid").get();
  assert.equal(snapshot.exists, true);
  assert.deepEqual(snapshot.data(), { status: "verified", base44UserId: "legacy-user" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-access-token");
});

test("maps a missing identity-link document to exists=false", async () => {
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async () => response({ error: { status: "NOT_FOUND", message: "missing" } }, 404),
  });
  const snapshot = await db.collection("identityLinks").doc("missing-uid").get();
  assert.equal(snapshot.exists, false);
  assert.equal(snapshot.data(), null);
});

test("queries a top-level collection with the legacy owner filter", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response([{
        document: {
          name: "projects/shelflife-tbr-9754d/databases/(default)/documents/Book/book-1",
          updateTime: "2026-11-10T03:00:00.000000Z",
          fields: {
            title: { stringValue: "Example" },
            pages: { integerValue: "123" },
            tags: { arrayValue: { values: [{ stringValue: "fiction" }] } },
          },
        },
      }]);
    },
  });
  const snapshot = await db.collection("Book")
    .where("created_by_id", "==", "legacy-user")
    .limit(20)
    .get();
  assert.equal(captured.url.endsWith("/documents:runQuery"), true);
  assert.deepEqual(captured.body.structuredQuery.where.fieldFilter, {
    field: { fieldPath: "created_by_id" },
    op: "EQUAL",
    value: { stringValue: "legacy-user" },
  });
  assert.equal(captured.body.structuredQuery.limit, 20);
  assert.deepEqual(snapshot.docs[0].data(), { title: "Example", pages: 123, tags: ["fiction"] });
  assert.equal(snapshot.docs[0].id, "book-1");
  assert.equal(snapshot.docs[0].updateTime, "2026-11-10T03:00:00.000000Z");
});

test("queries the authenticated user's nested books collection, not a caller-selected owner", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response([{
        document: {
          name: "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-1",
          fields: { title: { stringValue: "Example" } },
        },
      }]);
    },
  });
  const snapshot = await db.collection("users").doc("firebase-uid").collection("books").limit(25).get();
  assert.equal(captured.url.endsWith("/documents/users/firebase-uid:runQuery"), true);
  assert.deepEqual(captured.body.structuredQuery.from, [{ collectionId: "books" }]);
  assert.equal(captured.body.structuredQuery.limit, 25);
  assert.deepEqual(snapshot.docs.map((doc) => doc.id), ["book-1"]);
});

test("supports document-ID pagination within a nested collection", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response([]);
    },
  });
  await db.collection("users").doc("firebase-uid").collection("books")
    .limit(20).startAfter("book-017").get();
  assert.deepEqual(captured.body.structuredQuery.orderBy, [
    { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
  ]);
  assert.equal(
    captured.body.structuredQuery.startAt.values[0].referenceValue,
    "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-017",
  );
});

test("reads a nested document path", async () => {
  let url;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (requestUrl) => {
      url = requestUrl;
      return response({
        name: "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-1",
        fields: { title: { stringValue: "Example" } },
      });
    },
  });
  const snapshot = await db.collection("users").doc("firebase-uid").collection("books").doc("book-1").get();
  assert.equal(url.endsWith("/documents/users/firebase-uid/books/book-1"), true);
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.data().title, "Example");
});

test("rejects unsupported query fields, operators, collections, IDs and limits", async () => {
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async () => response([]),
  });
  assert.throws(() => db.collection("../identityLinks"), TypeError);
  assert.throws(() => db.collection("users").doc("../other"), TypeError);
  assert.throws(() => db.collection("Book").where("email", "==", "x"), TypeError);
  assert.throws(() => db.collection("Book").where("created_by_id", "!=", "x"), TypeError);
  assert.throws(() => db.collection("Book").where("created_by_id", "==", "x").limit(102).get(), TypeError);
  assert.throws(() => db.collection("users").doc("uid").collection("../books"), TypeError);
});

test("creates a nested library document with an explicit server-selected ID", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({
        name: "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-new",
        updateTime: "2026-11-10T03:00:00.000000Z",
        fields: { title: { stringValue: "New book" }, page_count: { integerValue: "321" } },
      });
    },
  });
  const created = await db.collection("users").doc("firebase-uid").collection("books")
    .doc("book-new").create({ title: "New book", page_count: 321 });
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.url.endsWith("/documents/users/firebase-uid/books?documentId=book-new"), true);
  assert.deepEqual(captured.body.fields, {
    title: { stringValue: "New book" },
    page_count: { integerValue: "321" },
  });
  assert.equal(created.id, "book-new");
  assert.equal(created.updateTime, "2026-11-10T03:00:00.000000Z");
});

test("updates only supplied fields and requires the last-read updateTime precondition", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({
        name: "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-1",
        updateTime: "2026-11-10T03:01:00.000000Z",
        fields: { title: { stringValue: "Updated" }, tags: { arrayValue: { values: [{ stringValue: "fiction" }] } } },
      });
    },
  });
  const updated = await db.collection("users").doc("firebase-uid").collection("books")
    .doc("book-1").update(
      { title: "Updated", tags: ["fiction"], omitted: undefined },
      { lastUpdateTime: "2026-11-10T03:00:00.000000Z" },
    );
  assert.equal(captured.options.method, "PATCH");
  assert.match(captured.url, /updateMask\.fieldPaths=title/);
  assert.match(captured.url, /updateMask\.fieldPaths=tags/);
  assert.match(captured.url, /currentDocument\.updateTime=/);
  assert.deepEqual(captured.body.fields, {
    title: { stringValue: "Updated" },
    tags: { arrayValue: { values: [{ stringValue: "fiction" }] } },
  });
  assert.equal(updated.updateTime, "2026-11-10T03:01:00.000000Z");
  await assert.rejects(
    db.collection("users").doc("firebase-uid").collection("books").doc("book-1").update({ title: "No precondition" }),
    /updateTime precondition/,
  );
});

test("deletes a document only with an updateTime precondition", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({});
    },
  });
  await db.collection("users").doc("firebase-uid").collection("shelves")
    .doc("shelf-1").delete({ lastUpdateTime: "2026-11-10T03:00:00.000000Z" });
  assert.equal(captured.options.method, "DELETE");
  assert.match(captured.url, /currentDocument\.updateTime=/);
  await assert.rejects(
    db.collection("users").doc("firebase-uid").collection("shelves").doc("shelf-1").delete(),
    /updateTime precondition/,
  );
});

test("encodes nested map, array, boolean and null Firestore fields", async () => {
  let body;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response({
        name: "projects/shelflife-tbr-9754d/databases/(default)/documents/users/firebase-uid/books/book-2",
        fields: {},
      });
    },
  });
  await db.collection("users").doc("firebase-uid").collection("books").doc("book-2")
    .create({ flags: { featured: true, note: null }, shelfIds: ["shelf-a", "shelf-b"] });
  assert.deepEqual(body.fields, {
    flags: {
      mapValue: {
        fields: {
          featured: { booleanValue: true },
          note: { nullValue: "NULL_VALUE" },
        },
      },
    },
    shelfIds: {
      arrayValue: {
        values: [{ stringValue: "shelf-a" }, { stringValue: "shelf-b" }],
      },
    },
  });
});

test("supports allowlisted social graph field filters with document-ID cursors", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response([]);
    },
  });
  await db.collection("relationships").where("followingUid", "==", "reader-1")
    .limit(25).startAfter("cursor-id").get();
  assert.equal(captured.url.endsWith("/documents:runQuery"), true);
  assert.deepEqual(captured.body.structuredQuery.where.fieldFilter, {
    field: { fieldPath: "followingUid" },
    op: "EQUAL",
    value: { stringValue: "reader-1" },
  });
  assert.equal(captured.body.structuredQuery.startAt.before, false);
  assert.equal(captured.body.structuredQuery.startAt.values[0].referenceValue.endsWith("/relationships/cursor-id"), true);
  assert.throws(
    () => db.collection("relationships").where("email", "==", "reader@example.test"),
    TypeError,
  );
});


test("supports boolean public-group filters and collection-group membership lookups", async () => {
  const calls = [];
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (calls.length === 1) {
        return response([{
          document: {
            name: "projects/shelflife-tbr-9754d/databases/(default)/documents/groups/group-public",
            fields: { name: { stringValue: "Public group" }, isPrivate: { booleanValue: false } },
          },
        }]);
      }
      return response([{
        document: {
          name: "projects/shelflife-tbr-9754d/databases/(default)/documents/groups/group-1/members/reader-1",
          fields: { uid: { stringValue: "reader-1" }, status: { stringValue: "active" } },
        },
      }]);
    },
  });

  const publicGroups = await db.collection("groups").where("isPrivate", "==", false).limit(10).get();
  assert.equal(calls[0].body.structuredQuery.where.fieldFilter.value.booleanValue, false);
  assert.equal(publicGroups.docs[0].id, "group-public");

  const memberships = await db.collectionGroup("members").where("uid", "==", "reader-1").limit(20).get();
  assert.deepEqual(calls[1].body.structuredQuery.from, [{ collectionId: "members", allDescendants: true }]);
  assert.equal(memberships.docs[0].ref.parent.parent.id, "group-1");
  assert.equal(memberships.docs[0].data().status, "active");
});


test("commits create, version-guarded update and delete writes atomically", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response({ writeResults: [{ updateTime: "2026-11-10T00:00:00Z" }] });
    },
  });
  await db.commitWrites([
    { type: "create", path: "shareLinks/link-1", data: { ownerUid: "readerA", enabled: true } },
    { type: "update", path: "users/readerA/books/book-1", data: { shareEnabled: true }, updateTime: "2026-11-10T00:00:00Z" },
    { type: "delete", path: "shareLinks/link-old", updateTime: "2026-11-10T00:00:00Z" },
  ]);
  assert.equal(captured.url.endsWith(":commit"), true);
  assert.equal(captured.body.writes.length, 3);
  assert.deepEqual(captured.body.writes[0].currentDocument, { exists: false });
  assert.deepEqual(captured.body.writes[1].currentDocument, { updateTime: "2026-11-10T00:00:00Z" });
  assert.deepEqual(captured.body.writes[1].update.updateMask.fieldPaths, ["shareEnabled"]);
  assert.equal(captured.body.writes[2].delete.endsWith("/shareLinks/link-old"), true);
});

test("rejects invalid Firestore batch paths, empty updates and missing preconditions", async () => {
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async () => response({}),
  });
  await assert.rejects(db.commitWrites([{ type: "create", path: "users/readerA/books/../book", data: {} }]), TypeError);
  await assert.rejects(db.commitWrites([{ type: "update", path: "users/readerA/books/book-1", data: {}, updateTime: "2026-11-10T00:00:00Z" }]), TypeError);
  await assert.rejects(db.commitWrites([{ type: "delete", path: "shareLinks/link-1" }]), TypeError);
  await assert.rejects(db.commitWrites([]), TypeError);
});
