import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedIdentityLinkPair, IdentityLinkConflictError } from "./identityLinking.js";

function fakeDb({ forward = null, reverse = null, failCommit = null } = {}) {
  const records = { identityLinks: forward, legacyIdentityLinks: reverse };
  let commits = 0;
  return {
    records,
    get commits() { return commits; },
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const value = records[name]?.[id];
              return { exists: Boolean(value), data: () => value };
            },
          };
        },
      };
    },
    async createIdentityLinkPair({ firebaseUid, base44UserId, verifiedAt }) {
      commits += 1;
      if (failCommit) throw failCommit;
      records.identityLinks ||= {};
      records.legacyIdentityLinks ||= {};
      if (records.identityLinks[firebaseUid] || records.legacyIdentityLinks[base44UserId]) {
        const error = new Error("already exists");
        error.code = "ALREADY_EXISTS";
        throw error;
      }
      const common = { status: "verified", proofMethod: "dual-session", verifiedAt, verifiedBy: firebaseUid };
      records.identityLinks[firebaseUid] = { ...common, base44UserId };
      records.legacyIdentityLinks[base44UserId] = { ...common, firebaseUid };
      return { writeResults: [{}, {}] };
    },
  };
}

const firebaseUser = { uid: "firebase-reader", emailVerified: true };
const base44User = { id: "legacy-reader" };

test("creates an atomic verified link only from both independently verified sessions", async () => {
  const db = fakeDb();
  const result = await createVerifiedIdentityLinkPair({
    db, firebaseUser, base44User, now: () => "2026-11-10T04:00:00.000Z",
  });
  assert.deepEqual(result, { linked: true, alreadyLinked: false });
  assert.equal(db.commits, 1);
  assert.equal(db.records.identityLinks["firebase-reader"].base44UserId, "legacy-reader");
  assert.equal(db.records.legacyIdentityLinks["legacy-reader"].firebaseUid, "firebase-reader");
});

test("is idempotent for a matching forward and reverse link", async () => {
  const common = { status: "verified", proofMethod: "dual-session" };
  const db = fakeDb({
    forward: { "firebase-reader": { ...common, base44UserId: "legacy-reader" } },
    reverse: { "legacy-reader": { ...common, firebaseUid: "firebase-reader" } },
  });
  const result = await createVerifiedIdentityLinkPair({ db, firebaseUser, base44User });
  assert.deepEqual(result, { linked: true, alreadyLinked: true });
  assert.equal(db.commits, 0);
});

test("rejects a legacy account or Firebase UID already linked elsewhere", async () => {
  const db = fakeDb({
    forward: { "firebase-reader": { status: "verified", base44UserId: "other-legacy" } },
  });
  await assert.rejects(
    createVerifiedIdentityLinkPair({ db, firebaseUser, base44User }),
    IdentityLinkConflictError,
  );
  assert.equal(db.commits, 0);
});

test("rejects unverified Firebase email and malformed IDs", async () => {
  const db = fakeDb();
  await assert.rejects(
    createVerifiedIdentityLinkPair({ db, firebaseUser: { ...firebaseUser, emailVerified: false }, base44User }),
    /verified Firebase email/,
  );
  await assert.rejects(
    createVerifiedIdentityLinkPair({ db, firebaseUser, base44User: { id: "../other" } }),
    /identity IDs/,
  );
  assert.equal(db.commits, 0);
});

test("resolves a create race as idempotent only when both links match", async () => {
  const db = fakeDb();
  db.createIdentityLinkPair = async () => {
    db.records.identityLinks = { "firebase-reader": { status: "verified", base44UserId: "legacy-reader" } };
    db.records.legacyIdentityLinks = { "legacy-reader": { status: "verified", firebaseUid: "firebase-reader" } };
    const error = new Error("already exists");
    error.code = "ALREADY_EXISTS";
    throw error;
  };
  const result = await createVerifiedIdentityLinkPair({ db, firebaseUser, base44User });
  assert.deepEqual(result, { linked: true, alreadyLinked: true });
});
