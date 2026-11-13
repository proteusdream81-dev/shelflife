import test from "node:test";
import assert from "node:assert/strict";
import {
  createShelfLifeBearerVerifier,
  resolveVerifiedBase44Principal,
} from "./shelfLifeBearerAuth.js";
import { InvalidBase44SessionError } from "./base44Session.js";

function fakeDb({ reverse, forward, forwardId = "firebase-user-1" }) {
  return {
    collection(name) {
      return {
        doc(id) {
          const data = name === "legacyIdentityLinks" ? reverse : forward;
          const expectedId = name === "legacyIdentityLinks" ? "legacy-user-1" : forwardId;
          return {
            async get() {
              return { exists: id === expectedId && Boolean(data), data: () => data };
            },
          };
        },
      };
    },
  };
}

test("resolves only a reciprocal verified identity link", async () => {
  const user = await resolveVerifiedBase44Principal({
    token: "valid-legacy-token",
    verifyLegacySession: async (token) => {
      assert.equal(token, "valid-legacy-token");
      return { id: "legacy-user-1" };
    },
    getDb: async () => fakeDb({
      reverse: { status: "verified", firebaseUid: "firebase-user-1" },
      forward: { status: "verified", base44UserId: "legacy-user-1" },
    }),
  });
  assert.deepEqual(user, {
    uid: "firebase-user-1",
    email: null,
    emailVerified: true,
    displayName: null,
  });
});

test("rejects missing or inconsistent reciprocal links", async () => {
  for (const pair of [
    { reverse: null, forward: { status: "verified", base44UserId: "legacy-user-1" } },
    { reverse: { status: "verified", firebaseUid: "firebase-user-1" }, forward: null },
    { reverse: { status: "verified", firebaseUid: "firebase-user-1" }, forward: { status: "pending", base44UserId: "legacy-user-1" } },
    { reverse: { status: "verified", firebaseUid: "firebase-user-1" }, forward: { status: "verified", base44UserId: "another-user" } },
  ]) {
    await assert.rejects(
      resolveVerifiedBase44Principal({
        token: "valid",
        verifyLegacySession: async () => ({ id: "legacy-user-1" }),
        getDb: async () => fakeDb(pair),
      }),
      InvalidBase44SessionError,
    );
  }
});

test("falls back to Base44 only after Firebase rejects the bearer token", async () => {
  const verify = createShelfLifeBearerVerifier({
    verifyFirebaseToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    verifyLegacySession: async () => ({ id: "legacy-user-1" }),
    allowLegacyFallback: () => true,
    getDb: async () => fakeDb({
      reverse: { status: "verified", firebaseUid: "firebase-user-1" },
      forward: { status: "verified", base44UserId: "legacy-user-1" },
    }),
  });
  const result = await verify({ headers: { authorization: "Bearer legacy-token" } });
  assert.equal(result.ok, true);
  assert.equal(result.user.uid, "firebase-user-1");
  assert.equal(result.user.emailVerified, true);
});

test("does not allow Base44 fallback outside the exact migration Preview branch", async () => {
  let legacyCalls = 0;
  const verify = createShelfLifeBearerVerifier({
    verifyFirebaseToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    verifyLegacySession: async () => { legacyCalls += 1; return { id: "legacy-user-1" }; },
    getDb: async () => fakeDb({
      reverse: { status: "verified", firebaseUid: "firebase-user-1" },
      forward: { status: "verified", base44UserId: "legacy-user-1" },
    }),
  });
  const result = await verify({ headers: { authorization: "Bearer legacy-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(legacyCalls, 0);
});

test("does not fall back when Firebase verification is unavailable", async () => {
  let legacyCalls = 0;
  const verify = createShelfLifeBearerVerifier({
    verifyFirebaseToken: async () => ({ ok: false, status: 503, error: "Unavailable" }),
    verifyLegacySession: async () => { legacyCalls += 1; return { id: "legacy-user-1" }; },
  });
  const result = await verify({ headers: { authorization: "Bearer token" } });
  assert.equal(result.status, 503);
  assert.equal(legacyCalls, 0);
});

test("does not accept an unlinked Base44 identity", async () => {
  const verify = createShelfLifeBearerVerifier({
    verifyFirebaseToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    verifyLegacySession: async () => ({ id: "legacy-user-1" }),
    allowLegacyFallback: () => true,
    getDb: async () => fakeDb({ reverse: null, forward: null }),
  });
  const result = await verify({ headers: { authorization: "Bearer legacy-token" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("resolves deterministic Base44 principal mappings without inventing email verification", async () => {
  const derivedUid = "b44_" + "a".repeat(64);
  const user = await resolveVerifiedBase44Principal({
    token: "valid-base44-token",
    verifyLegacySession: async () => ({
      id: "legacy-user-1",
      email: "reader@example.test",
      emailVerified: false,
      displayName: "Reader",
    }),
    getDb: async () => fakeDb({
      reverse: {
        status: "verified",
        firestoreUid: derivedUid,
        authProvider: "base44",
      },
      forward: {
        status: "verified",
        base44UserId: "legacy-user-1",
        authProvider: "base44",
      },
      forwardId: derivedUid,
    }),
  });
  assert.equal(user.uid, derivedUid);
  assert.equal(user.email, "reader@example.test");
  assert.equal(user.emailVerified, false);
  assert.equal(user.displayName, "Reader");
});

test("rejects deterministic principal mappings without matching Base44 provider markers", async () => {
  await assert.rejects(resolveVerifiedBase44Principal({
    token: "valid",
    verifyLegacySession: async () => ({ id: "legacy-user-1" }),
    getDb: async () => fakeDb({
      reverse: { status: "verified", firestoreUid: "b44_" + "a".repeat(64), authProvider: "firebase" },
      forward: { status: "verified", base44UserId: "legacy-user-1" },
      forwardId: "b44_" + "a".repeat(64),
    }),
  }), InvalidBase44SessionError);
});
