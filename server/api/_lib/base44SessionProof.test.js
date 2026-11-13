import test from "node:test";
import assert from "node:assert/strict";
import { createBase44SessionProofHandler } from "./base44SessionProof.js";
import { InvalidBase44SessionError } from "./base44Session.js";

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("accepts a verified Base44 bearer session only in the migration Preview deployment", async () => {
  const res = response();
  const handler = createBase44SessionProofHandler({
    allowedDeployment: () => true,
    verifySession: async (token) => {
      assert.equal(token, "valid-base44-token");
      return { id: "private-user-id" };
    },
  });
  await handler({ method: "GET", headers: { authorization: "Bearer valid-base44-token" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    authenticated: true,
    identityProvider: "base44",
    migrationMode: "compatibility-preview",
    firebaseAccountLinked: false,
    dataAccessEnabled: false,
  });
  assert.equal(JSON.stringify(res.body).includes("private-user-id"), false);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("rejects requests outside the isolated Preview deployment", async () => {
  const res = response();
  let verifyCalls = 0;
  await createBase44SessionProofHandler({
    allowedDeployment: () => false,
    verifySession: async () => { verifyCalls += 1; return { id: "user" }; },
  })({ method: "GET", headers: { authorization: "Bearer token" } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(verifyCalls, 0);
});

test("rejects missing, malformed, and invalid sessions", async () => {
  for (const headers of [{}, { authorization: "Basic token" }, { authorization: "Bearer bad token" }]) {
    const res = response();
    await createBase44SessionProofHandler({ allowedDeployment: () => true })(
      { method: "GET", headers }, res,
    );
    assert.equal(res.statusCode, 401);
  }
  const invalid = response();
  await createBase44SessionProofHandler({
    allowedDeployment: () => true,
    verifySession: async () => { throw new InvalidBase44SessionError(); },
  })({ method: "GET", headers: { authorization: "Bearer expired-token" } }, invalid);
  assert.equal(invalid.statusCode, 401);
});

test("does not accept unsupported methods", async () => {
  const res = response();
  await createBase44SessionProofHandler({ allowedDeployment: () => true })(
    { method: "DELETE", headers: {} }, res,
  );
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST");
});
