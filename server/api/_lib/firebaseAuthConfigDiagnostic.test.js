import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseAuthConfigDiagnostic } from "./firebaseAuthConfigDiagnostic.js";

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const previewEnv = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
};

test.beforeEach(() => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "migration/firebase-profile-bridge";
  process.env.FIREBASE_PROJECT_ID = "shelflife-tbr-dev";
});
test.after(() => {
  for (const [key, value] of Object.entries(previewEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("reads only safe Firebase Auth config summary in the isolated Preview project", async () => {
  let calls = 0;
  const handler = createFirebaseAuthConfigDiagnostic({
    getConfig: async () => {
      calls += 1;
      return {
        projectId: "shelflife-tbr-dev",
        previewDomainAuthorized: true,
        googleProviderConfigured: true,
        googleProviderEnabled: false,
        googleClientIdPresent: true,
        googleClientIdMatchesApp: false,
        supportEmail: "must-not-leak@example.test",
        oauthClientSecret: "must-not-leak",
      };
    },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    projectId: "shelflife-tbr-dev",
    authConfigReadable: true,
    previewDomainAuthorized: true,
    googleProviderConfigured: true,
    googleProviderEnabled: false,
    googleClientIdPresent: true,
    googleClientIdMatchesApp: false,
  });
  assert.equal(calls, 1);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("does not call Firebase for non-GET requests", async () => {
  let calls = 0;
  const handler = createFirebaseAuthConfigDiagnostic({ getConfig: async () => { calls += 1; } });
  const res = response();
  await handler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.equal(calls, 0);
});

test("is unavailable outside the exact development Preview branch", async () => {
  let calls = 0;
  const handler = createFirebaseAuthConfigDiagnostic({ getConfig: async () => { calls += 1; } });
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls, 0);
});

test("does not accept caller-supplied request data", async () => {
  let calls = 0;
  const handler = createFirebaseAuthConfigDiagnostic({ getConfig: async () => { calls += 1; } });
  const res = response();
  await handler({ method: "GET", body: { projectId: "production" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls, 0);
});

test("returns a sanitized failure when Google IAM denies the read", async () => {
  const handler = createFirebaseAuthConfigDiagnostic({
    getConfig: async () => { const error = new Error("sensitive detail"); error.code = 403; throw error; },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "403");
  assert.equal(res.body.errorType, "Error");
  assert.equal(res.body.stage, "project-config");
  assert.equal(JSON.stringify(res.body).includes("sensitive detail"), false);
});
