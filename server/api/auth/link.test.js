import test from "node:test";
import assert from "node:assert/strict";
import { createIdentityLinkHandler } from "./link.js";
import { InvalidBase44SessionError } from "../_lib/base44Session.js";

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}
const firebaseAuth = async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: true } });

test("verifies both sessions but creates no Firestore mapping while migration writes are disabled", async () => {
  let linkCalls = 0;
  const res = response();
  const handler = createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
    verifyLegacySession: async (token) => {
      assert.equal(token, "base44-session-token");
      return { id: "legacy-reader" };
    },
    writesEnabled: () => false,
    linkAccounts: async () => { linkCalls += 1; },
  });
  await handler({
    method: "POST",
    headers: { authorization: "Bearer firebase-token" },
    body: { base44Token: "base44-session-token" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { proofVerified: true, linked: false, writesDisabled: true });
  assert.equal(linkCalls, 0);
});

test("creates an identity link only when the explicit migration write flag is enabled", async () => {
  let captured;
  const res = response();
  const handler = createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
    verifyLegacySession: async () => ({ id: "legacy-reader" }),
    writesEnabled: () => true,
    getDb: async () => ({ database: true }),
    linkAccounts: async (args) => {
      captured = args;
      return { linked: true, alreadyLinked: false };
    },
  });
  await handler({ method: "POST", headers: {}, body: { base44Token: "token" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { proofVerified: true, linked: true, alreadyLinked: false, writesDisabled: false });
  assert.equal(captured.firebaseUser.uid, "firebase-reader");
  assert.equal(captured.base44User.id, "legacy-reader");
});

test("rejects unverified Firebase users and malformed bodies", async () => {
  const unverified = response();
  await createIdentityLinkHandler({
    verifyFirebaseToken: async () => ({ ok: true, user: { uid: "firebase-reader", emailVerified: false } }),
    verifyLegacySession: async () => ({ id: "legacy-reader" }),
  })({ method: "POST", headers: {}, body: { base44Token: "token" } }, unverified);
  assert.equal(unverified.statusCode, 403);

  const malformed = response();
  await createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
  })({ method: "POST", headers: {}, body: { base44Token: "token", base44UserId: "forged" } }, malformed);
  assert.equal(malformed.statusCode, 400);
});

test("rejects invalid legacy sessions without creating a link", async () => {
  let linkCalls = 0;
  const res = response();
  await createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
    verifyLegacySession: async () => { throw new InvalidBase44SessionError(); },
    writesEnabled: () => true,
    linkAccounts: async () => { linkCalls += 1; },
  })({ method: "POST", headers: {}, body: { base44Token: "invalid-token" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(linkCalls, 0);
});

test("supports only POST", async () => {
  const res = response();
  await createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
    verifyLegacySession: async () => ({ id: "legacy-reader" }),
    writesEnabled: () => false,
  })({ method: "GET", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
});


test("dry-run verifies both sessions without writing even when link writes are enabled", async () => {
  let linkCalls = 0;
  let dbCalls = 0;
  const res = response();
  await createIdentityLinkHandler({
    verifyFirebaseToken: firebaseAuth,
    verifyLegacySession: async () => ({ id: "legacy-reader" }),
    writesEnabled: () => true,
    getDb: async () => { dbCalls += 1; return {}; },
    linkAccounts: async () => { linkCalls += 1; },
  })({
    method: "POST",
    headers: {},
    body: { base44Token: "legacy-session-token", dryRun: true },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    proofVerified: true, linked: false, writesDisabled: true, dryRun: true,
  });
  assert.equal(dbCalls, 0);
  assert.equal(linkCalls, 0);
});


test("returns both independently verified IDs only behind the dev Preview audit gate", async () => {
  const previous = {
    vercelEnv: process.env.VERCEL_ENV,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    project: process.env.FIREBASE_PROJECT_ID,
    enabled: process.env.MIGRATION_IDENTITY_PROOF_IDS_ENABLED,
  };
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "migration/firebase-profile-bridge";
  process.env.FIREBASE_PROJECT_ID = "shelflife-tbr-dev";
  process.env.MIGRATION_IDENTITY_PROOF_IDS_ENABLED = "true";
  try {
    const res = response();
    await createIdentityLinkHandler({
      verifyFirebaseToken: firebaseAuth,
      verifyLegacySession: async () => ({ id: "legacy-reader" }),
      writesEnabled: () => false,
    })({ method: "POST", headers: {}, body: { base44Token: "legacy-session-token", dryRun: true } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.verifiedIdentity, {
      firebaseUid: "firebase-reader",
      base44UserId: "legacy-reader",
      proofMethod: "dual-session",
      verifiedAt: res.body.verifiedIdentity.verifiedAt,
    });
    assert.ok(Number.isFinite(Date.parse(res.body.verifiedIdentity.verifiedAt)));
    assert.equal(res.body.linked, false);
    assert.equal(res.body.writesDisabled, true);
  } finally {
    for (const [key, value] of Object.entries({
      VERCEL_ENV: previous.vercelEnv,
      VERCEL_GIT_COMMIT_REF: previous.branch,
      FIREBASE_PROJECT_ID: previous.project,
      MIGRATION_IDENTITY_PROOF_IDS_ENABLED: previous.enabled,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
