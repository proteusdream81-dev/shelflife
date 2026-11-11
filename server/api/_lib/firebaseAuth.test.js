import test from "node:test";
import assert from "node:assert/strict";
import { verifyFirebaseBearerToken, getFirebaseAdminFirestoreSmokeTest } from "./firebaseAuth.js";

const projectId = "shelflife-tbr-9754d";
const devProjectId = "shelflife-tbr-dev";
const token = "unit-test-firebase-id-token";
const decoded = {
  aud: projectId,
  iss: `https://securetoken.google.com/${projectId}`,
  uid: "firebase-test-user",
  email: "reader@example.test",
  email_verified: true,
  name: "Test Reader",
};

function setProject(projectId) {
  process.env.FIREBASE_PROJECT_ID = projectId;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_GIT_COMMIT_REF;
}

function request(value = token) {
  return { headers: value ? { authorization: `Bearer ${value}` } : {} };
}

function mockAuth(implementation = async () => decoded) {
  const calls = [];
  return {
    calls,
    auth: {
      verifyIdToken: async (...args) => {
        calls.push(args);
        return implementation(...args);
      },
    },
  };
}

test("verifies ID tokens through Admin SDK with revocation checking enabled", async () => {
  setProject(projectId);
  const mock = mockAuth();
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });

  assert.equal(result.ok, true);
  assert.deepEqual(result.user, {
    uid: "firebase-test-user",
    email: "reader@example.test",
    emailVerified: true,
    displayName: "Test Reader",
  });
  assert.deepEqual(mock.calls, [[token, true]]);
});

test("rejects missing bearer tokens", async () => {
  setProject(projectId);
  const result = await verifyFirebaseBearerToken(request(null), { auth: mockAuth().auth });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects expired tokens", async () => {
  setProject(projectId);
  const mock = mockAuth(async () => { throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects revoked tokens", async () => {
  setProject(projectId);
  const mock = mockAuth(async () => { throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects disabled users", async () => {
  setProject(projectId);
  const mock = mockAuth(async () => { throw Object.assign(new Error("disabled"), { code: "auth/user-disabled" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects claims from another Firebase project", async () => {
  setProject(projectId);
  const mock = mockAuth(async () => ({ ...decoded, aud: "another-project" }));
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("fails closed when the project configuration is wrong", async () => {
  setProject("wrong-project");
  const result = await verifyFirebaseBearerToken(request(), { auth: mockAuth().auth });
  assert.equal(result.status, 503);
  setProject(projectId);
});

test("fails closed for an invalid service identity when no injected auth is provided", async () => {
  setProject(projectId);
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const result = await verifyFirebaseBearerToken(request());
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test("accepts development Firebase tokens only on the isolated migration Preview branch", async () => {
  process.env.FIREBASE_PROJECT_ID = devProjectId;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "migration/firebase-profile-bridge";
  const devDecoded = {
    ...decoded,
    aud: devProjectId,
    iss: `https://securetoken.google.com/${devProjectId}`,
  };
  const mock = mockAuth(async () => devDecoded);
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });

  assert.equal(result.ok, true);
  assert.equal(result.user.uid, "firebase-test-user");
  assert.deepEqual(mock.calls, [[token, true]]);
  setProject(projectId);
});

test("fails closed if a Preview deployment selects the development project from another branch", async () => {
  process.env.FIREBASE_PROJECT_ID = devProjectId;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "feature/unapproved-branch";
  const result = await verifyFirebaseBearerToken(request(), { auth: mockAuth().auth });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  setProject(projectId);
});


test("enables the writable smoke-test client only on the exact development Preview branch", async () => {
  const previous = {
    project: process.env.FIREBASE_PROJECT_ID,
    env: process.env.VERCEL_ENV,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    enabled: process.env.FIREBASE_WIF_SMOKE_TEST_ENABLED,
  };
  process.env.FIREBASE_PROJECT_ID = devProjectId;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "feature/unapproved-branch";
  process.env.FIREBASE_WIF_SMOKE_TEST_ENABLED = "true";
  try {
    await assert.rejects(getFirebaseAdminFirestoreSmokeTest(), /restricted to the migration branch/);
    process.env.VERCEL_GIT_COMMIT_REF = "migration/firebase-profile-bridge";
    process.env.VERCEL_ENV = "production";
    await assert.rejects(getFirebaseAdminFirestoreSmokeTest(), /Production must use the production Firebase project/);
  } finally {
    for (const [key, value] of Object.entries({
      FIREBASE_PROJECT_ID: previous.project,
      VERCEL_ENV: previous.env,
      VERCEL_GIT_COMMIT_REF: previous.branch,
      FIREBASE_WIF_SMOKE_TEST_ENABLED: previous.enabled,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
