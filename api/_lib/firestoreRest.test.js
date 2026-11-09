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

test("queries only created_by_id with a bounded limit and decodes documents", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return response([{
        document: {
          name: "projects/shelflife-tbr-9754d/databases/(default)/documents/Book/book-1",
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
  assert.equal(captured.url.endsWith(":runQuery"), true);
  assert.deepEqual(captured.body.structuredQuery.where.fieldFilter, {
    field: { fieldPath: "created_by_id" },
    op: "EQUAL",
    value: { stringValue: "legacy-user" },
  });
  assert.equal(captured.body.structuredQuery.limit, 20);
  assert.deepEqual(snapshot.docs[0].data(), { title: "Example", pages: 123, tags: ["fiction"] });
  assert.equal(snapshot.docs[0].id, "book-1");
});

test("rejects unsupported query fields, operators, collections, and limits", async () => {
  const db = createFirestoreRestClient({
    getAccessToken: async () => "test-access-token",
    fetchImpl: async () => response([]),
  });
  assert.throws(() => db.collection("../identityLinks"), TypeError);
  assert.throws(() => db.collection("Book").where("email", "==", "x"), TypeError);
  assert.throws(() => db.collection("Book").where("created_by_id", "!=", "x"), TypeError);
  assert.throws(() => db.collection("Book").where("created_by_id", "==", "x").limit(101), TypeError);
});
