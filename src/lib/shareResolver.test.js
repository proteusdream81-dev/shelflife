import test from "node:test";
import assert from "node:assert/strict";
import { loadSharePayload, normalizeFirebaseShare } from "./shareResolver.js";

 test("normalizes a Firebase book share to the legacy Share page contract", () => {
  const result = normalizeFirebaseShare({
    kind: "book", ownerName: "Reader One", coversHidden: true,
    item: { id: "book-1", title: "Example" },
  });
  assert.equal(result.reader_name, "Reader One");
  assert.equal(result.covers_hidden, true);
  assert.equal(result.shareProvider, "firebase");
  assert.equal(result.book.title, "Example");
});

test("normalizes a Firebase shelf share and defaults missing books to an array", () => {
  const result = normalizeFirebaseShare({ kind: "shelf", ownerName: "Reader Two", item: { name: "TBR" } });
  assert.equal(result.reader_name, "Reader Two");
  assert.equal(result.shelf.name, "TBR");
  assert.deepEqual(result.books, []);
});

test("resolves Firebase-native tokens without calling Base44", async () => {
  let legacyCalls = 0;
  const result = await loadSharePayload({
    token: "firebase-token", firebaseEnabled: true,
    getFirebaseShare: async () => ({ kind: "book", ownerName: "Reader", item: { title: "Native" } }),
    getLegacyShare: async () => { legacyCalls += 1; return { data: {} }; },
  });
  assert.equal(result.book.title, "Native");
  assert.equal(legacyCalls, 0);
});

test("falls back to Base44 only when Firebase reports an unknown token", async () => {
  let receivedToken = "";
  const result = await loadSharePayload({
    token: "legacy-token", firebaseEnabled: true,
    getFirebaseShare: async () => { const error = new Error("not found"); error.status = 404; throw error; },
    getLegacyShare: async (token) => { receivedToken = token; return { data: { kind: "book", book: { title: "Legacy" } } }; },
  });
  assert.equal(receivedToken, "legacy-token");
  assert.equal(result.book.title, "Legacy");
});

test("does not mask Firebase service failures with a legacy lookup", async () => {
  let legacyCalls = 0;
  await assert.rejects(() => loadSharePayload({
    token: "token", firebaseEnabled: true,
    getFirebaseShare: async () => { const error = new Error("unavailable"); error.status = 503; throw error; },
    getLegacyShare: async () => { legacyCalls += 1; return { data: {} }; },
  }), /unavailable/);
  assert.equal(legacyCalls, 0);
});

test("uses Base44 directly when Firebase is not configured", async () => {
  let firebaseCalls = 0;
  const result = await loadSharePayload({
    token: "legacy-token", firebaseEnabled: false,
    getFirebaseShare: async () => { firebaseCalls += 1; return {}; },
    getLegacyShare: async () => ({ data: { kind: "shelf", books: [] } }),
  });
  assert.equal(result.kind, "shelf");
  assert.equal(firebaseCalls, 0);
});