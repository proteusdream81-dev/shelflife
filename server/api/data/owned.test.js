import test from "node:test";
import assert from "node:assert/strict";
import { createOwnedDataDiagnosticHandler } from "./owned.js";
import { IdentityNotLinkedError, ProfileNotMigratedError } from "../_lib/profile.js";

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

const verified = async () => ({
  ok: true,
  user: { uid: "firebase-reader", emailVerified: true },
});

test("returns only a count and capped flag after profile and identity checks", async () => {
  let requested;
  const res = response();
  const handler = createOwnedDataDiagnosticHandler({
    verifyToken: verified,
    getDb: async () => ({ db: true }),
    resolveProfile: async ({ firebaseUser }) => assert.equal(firebaseUser.uid, "firebase-reader"),
    listRecords: async (args) => {
      requested = args;
      return Array.from({ length: 100 }, (_, index) => ({ id: String(index), private: "must not return" }));
    },
  });
  await handler({
    method: "GET",
    headers: {},
    query: { entity: "Book", limit: "100", countOnly: "true" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(requested, { db: { db: true }, firebaseUid: "firebase-reader", entity: "Book", limit: 100 });
  assert.deepEqual(res.body, { entity: "Book", count: 100, capped: true });
  assert.equal("records" in res.body, false);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("refuses requests that try to retrieve record contents", async () => {
  let readCalled = false;
  const res = response();
  const handler = createOwnedDataDiagnosticHandler({
    verifyToken: verified,
    listRecords: async () => { readCalled = true; return []; },
  });
  await handler({ method: "GET", headers: {}, query: { entity: "Book" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(readCalled, false);
});

test("requires verified authentication and email", async () => {
  const unauthorized = response();
  await createOwnedDataDiagnosticHandler({
    verifyToken: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
  })({ method: "GET", headers: {}, query: { entity: "Book", countOnly: "true" } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const unverified = response();
  await createOwnedDataDiagnosticHandler({
    verifyToken: async () => ({ ok: true, user: { uid: "reader", emailVerified: false } }),
  })({ method: "GET", headers: {}, query: { entity: "Book", countOnly: "true" } }, unverified);
  assert.equal(unverified.statusCode, 403);
});

test("requires a verified identity link and existing migrated profile", async () => {
  for (const error of [new IdentityNotLinkedError(), new ProfileNotMigratedError()]) {
    const res = response();
    const handler = createOwnedDataDiagnosticHandler({
      verifyToken: verified,
      getDb: async () => ({}),
      resolveProfile: async () => { throw error; },
      listRecords: async () => { throw new Error("must not read"); },
    });
    await handler({ method: "GET", headers: {}, query: { entity: "Book", countOnly: "true" } }, res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { error: "Account migration is not complete" });
  }
});

test("rejects unsupported entities and invalid limits", async () => {
  for (const query of [
    { entity: "User", countOnly: "true" },
    { entity: "Book", limit: "0", countOnly: "true" },
    { entity: "Book", limit: "101", countOnly: "true" },
  ]) {
    const res = response();
    await createOwnedDataDiagnosticHandler({
      verifyToken: verified,
      listRecords: async () => { throw new Error("must not read"); },
    })({ method: "GET", headers: {}, query }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("allows only GET and returns a generic error for data service failures", async () => {
  const method = response();
  await createOwnedDataDiagnosticHandler({
    verifyToken: verified,
  })({ method: "POST", headers: {}, query: {} }, method);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.Allow, "GET");

  const failed = response();
  await createOwnedDataDiagnosticHandler({
    verifyToken: verified,
    getDb: async () => { throw new Error("sensitive internal detail"); },
  })({ method: "GET", headers: {}, query: { entity: "Book", countOnly: "true" } }, failed);
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.body, { error: "Data service unavailable" });
  assert.doesNotMatch(JSON.stringify(failed.body), /sensitive internal detail/);
});
