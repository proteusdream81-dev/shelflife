import test from "node:test";
import assert from "node:assert/strict";
import { verifyFirebaseBearerToken } from "./firebaseAuth.js";

const projectId = "shelflife-tbr-9754d";
const projectNumber = "599157455651";
const token = "unit-test-firebase-id-token";
const decoded = {
  aud: projectId,
  iss: `https://securetoken.google.com/${projectId}`,
  uid: "firebase-test-user",
  email: "reader@example.test",
  email_verified: true,
  name: "Test Reader",
};

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

function setProjectEnv() {
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.GCP_PROJECT_NUMBER = projectNumber;
}

test("verifies ID tokens through Admin SDK with revocation checking enabled", async () => {
  setProjectEnv();
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
  setProjectEnv();
  const result = await verifyFirebaseBearerToken(request(null), { auth: mockAuth().auth });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects expired tokens", async () => {
  setProjectEnv();
  const mock = mockAuth(async () => { throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects revoked tokens", async () => {
  setProjectEnv();
  const mock = mockAuth(async () => { throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects disabled users", async () => {
  setProjectEnv();
  const mock = mockAuth(async () => { throw Object.assign(new Error("disabled"), { code: "auth/user-disabled" }); });
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("rejects claims from another Firebase project", async () => {
  setProjectEnv();
  const mock = mockAuth(async () => ({ ...decoded, aud: "another-project" }));
  const result = await verifyFirebaseBearerToken(request(), { auth: mock.auth });
  assert.equal(result.status, 401);
});

test("fails closed when the project configuration is wrong", async () => {
  process.env.FIREBASE_PROJECT_ID = "wrong-project";
  process.env.GCP_PROJECT_NUMBER = projectNumber;
  const result = await verifyFirebaseBearerToken(request(), { auth: mockAuth().auth });
  assert.equal(result.status, 503);
  setProjectEnv();
});

test("fails closed when project identity env is missing", async () => {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GCP_PROJECT_NUMBER;
  const result = await verifyFirebaseBearerToken(request(), { auth: mockAuth().auth });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  setProjectEnv();
});

test("fails closed for an invalid service identity when no injected auth is provided", async () => {
  setProjectEnv();
  delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const result = await verifyFirebaseBearerToken(request());
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
