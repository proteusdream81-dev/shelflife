import test from "node:test";
import assert from "node:assert/strict";
import {
  createBase44SessionVerifier,
  InvalidBase44SessionError,
} from "./base44Session.js";

test("verifies Base44 sessions server-side and returns only allowlisted identity metadata", async () => {
  let config;
  const verify = createBase44SessionVerifier({
    getAppId: () => "a".repeat(32),
    createClientImpl: (options) => {
      config = options;
      return { auth: { me: async () => ({
        id: "legacy-user-1",
        email: "reader@example.test",
        email_verified: true,
        full_name: "Reader",
        role: "admin",
        private_field: "must-not-escape",
      }) } };
    },
  });
  const user = await verify("valid-token");
  assert.deepEqual(config, {
    appId: "a".repeat(32),
    token: "valid-token",
    serverUrl: "https://base44.app",
  });
  assert.deepEqual(user, {
    id: "legacy-user-1",
    email: "reader@example.test",
    emailVerified: true,
    displayName: "Reader",
  });
  assert.equal("role" in user, false);
  assert.equal("private_field" in user, false);
});

test("does not invent email verification when Base44 omits the verified flag", async () => {
  const verify = createBase44SessionVerifier({
    getAppId: () => "b".repeat(32),
    createClientImpl: () => ({ auth: { me: async () => ({ id: "legacy-user-1" }) } }),
  });
  const user = await verify("valid-token");
  assert.equal(user.emailVerified, false);
});

test("rejects malformed tokens, malformed users and Base44 auth failures", async () => {
  const verify = createBase44SessionVerifier({
    getAppId: () => "c".repeat(32),
    createClientImpl: () => ({ auth: { me: async () => { throw new Error("unauthorized"); } } }),
  });
  await assert.rejects(verify("contains whitespace"), InvalidBase44SessionError);
  await assert.rejects(verify("valid-token"), InvalidBase44SessionError);
  const malformed = createBase44SessionVerifier({
    getAppId: () => "d".repeat(32),
    createClientImpl: () => ({ auth: { me: async () => ({ id: "bad/id" }) } }),
  });
  await assert.rejects(malformed("valid-token"), InvalidBase44SessionError);
});
