import test from "node:test";
import assert from "node:assert/strict";
import { createFirestoreRestClient } from "./firestoreRest.js";

test("creates forward and reverse identity links atomically with create-only preconditions", async () => {
  let captured;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "google-access-token",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ writeResults: [{}, {}] }) };
    },
  });

  const result = await db.createIdentityLinkPair({
    firebaseUid: "firebase-reader",
    base44UserId: "legacy-reader",
    verifiedAt: "2026-11-10T04:00:00.000Z",
  });

  assert.equal(captured.url.endsWith("/documents:commit"), true);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer google-access-token");
  assert.equal(captured.body.writes.length, 2);
  assert.equal(captured.body.writes[0].currentDocument.exists, false);
  assert.equal(captured.body.writes[1].currentDocument.exists, false);
  assert.match(captured.body.writes[0].update.name, /documents\/identityLinks\/firebase-reader$/);
  assert.match(captured.body.writes[1].update.name, /documents\/legacyIdentityLinks\/legacy-reader$/);
  assert.deepEqual(captured.body.writes[0].update.fields, {
    status: { stringValue: "verified" },
    proofMethod: { stringValue: "dual-session" },
    verifiedAt: { stringValue: "2026-11-10T04:00:00.000Z" },
    verifiedBy: { stringValue: "firebase-reader" },
    base44UserId: { stringValue: "legacy-reader" },
  });
  assert.deepEqual(captured.body.writes[1].update.fields, {
    status: { stringValue: "verified" },
    proofMethod: { stringValue: "dual-session" },
    verifiedAt: { stringValue: "2026-11-10T04:00:00.000Z" },
    verifiedBy: { stringValue: "firebase-reader" },
    firebaseUid: { stringValue: "firebase-reader" },
  });
  assert.deepEqual(result, { writeResults: [{}, {}] });
});

test("rejects malformed identity IDs and timestamps before Firestore writes", async () => {
  let calls = 0;
  const db = createFirestoreRestClient({
    getAccessToken: async () => "token",
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  await assert.rejects(
    db.createIdentityLinkPair({ firebaseUid: "../other", base44UserId: "legacy", verifiedAt: "2026-11-10T04:00:00Z" }),
    /identity IDs/,
  );
  await assert.rejects(
    db.createIdentityLinkPair({ firebaseUid: "firebase", base44UserId: "legacy", verifiedAt: "not-a-date" }),
    /timestamp/,
  );
  assert.equal(calls, 0);
});
