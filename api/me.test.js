import test from "node:test";
import assert from "node:assert/strict";
import { createMeHandler } from "./me.js";
import { IdentityNotLinkedError, ProfileNotMigratedError } from "./_lib/profile.js";

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const verifiedUser = {
  uid: "firebase-uid",
  email: "reader@example.test",
  emailVerified: true,
  displayName: "Reader",
};

test("allows GET only", async () => {
  const res = response();
  await createMeHandler()({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});

test("returns authentication failures without querying Firestore", async () => {
  let databaseOpened = false;
  const handler = createMeHandler({
    verifyToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
    getDb: async () => { databaseOpened = true; return {}; },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(databaseOpened, false);
});

test("requires verified email", async () => {
  let databaseOpened = false;
  const handler = createMeHandler({
    verifyToken: async () => ({ ok: true, user: { ...verifiedUser, emailVerified: false } }),
    getDb: async () => { databaseOpened = true; return {}; },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(databaseOpened, false);
});

test("returns only the resolved Firebase profile", async () => {
  const profile = { uid: "firebase-uid", email: "reader@example.test", profile: { username: "reader" } };
  const handler = createMeHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => ({}),
    resolveProfile: async ({ firebaseUser }) => {
      assert.equal(firebaseUser.uid, "firebase-uid");
      return profile;
    },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { user: profile });
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers.Vary, "Authorization");
});

test("returns 409 when the legacy identity link is missing", async () => {
  const handler = createMeHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Account link is not established" });
});

test("returns 409 instead of creating a blank migrated profile", async () => {
  const handler = createMeHandler({
    verifyToken: async () => ({ ok: true, user: verifiedUser }),
    getDb: async () => ({}),
    resolveProfile: async () => { throw new ProfileNotMigratedError(); },
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Profile migration is not complete" });
});
