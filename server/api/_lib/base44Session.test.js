import test from "node:test";
import assert from "node:assert/strict";
import {
  createBase44SessionVerifier,
  InvalidBase44SessionError,
} from "./base44Session.js";

test("verifies the Base44 session server-side and returns only the legacy identity ID", async () => {
  let clientOptions;
  const verify = createBase44SessionVerifier({
    getAppId: () => "a".repeat(32),
    createClientImpl: (options) => {
      clientOptions = options;
      return {
        auth: {
          me: async () => ({
            id: "legacy-reader-1",
            email: "reader@example.test",
            role: "admin",
            privateField: "must-not-escape",
          }),
        },
      };
    },
  });

  const result = await verify("opaque-session-token");
  assert.deepEqual(clientOptions, {
    appId: "a".repeat(32),
    token: "opaque-session-token",
    serverUrl: "https://base44.app",
  });
  assert.deepEqual(result, { id: "legacy-reader-1" });
  assert.equal("email" in result, false);
  assert.equal("role" in result, false);
  assert.equal("privateField" in result, false);
});

test("rejects malformed tokens before constructing a Base44 client", async () => {
  let clientCreated = false;
  const verify = createBase44SessionVerifier({
    getAppId: () => "b".repeat(32),
    createClientImpl: () => {
      clientCreated = true;
      return { auth: { me: async () => ({ id: "legacy-reader-1" }) } };
    },
  });

  for (const token of ["", "contains whitespace", "token\nwith-newline", "x".repeat(10001), null]) {
    await assert.rejects(verify(token), InvalidBase44SessionError);
  }
  assert.equal(clientCreated, false);
});

test("rejects invalid or unsafe Base44 user IDs", async () => {
  for (const id of ["", "   ", ".", "..", "../other", "legacy/other", "bad\u0000id", "x".repeat(129)]) {
    const verify = createBase44SessionVerifier({
      getAppId: () => "c".repeat(32),
      createClientImpl: () => ({ auth: { me: async () => ({ id }) } }),
    });
    await assert.rejects(verify("valid-token"), InvalidBase44SessionError);
  }
});

test("rejects an invalid server app ID without calling the SDK", async () => {
  let clientCreated = false;
  const verify = createBase44SessionVerifier({
    getAppId: () => "not-a-base44-app-id",
    createClientImpl: () => {
      clientCreated = true;
      return { auth: { me: async () => ({ id: "legacy-reader-1" }) } };
    },
  });

  await assert.rejects(verify("valid-token"), /Base44 server app ID is not configured/);
  assert.equal(clientCreated, false);
});

test("maps Base44 authentication failures to an invalid-session result", async () => {
  const verify = createBase44SessionVerifier({
    getAppId: () => "d".repeat(32),
    createClientImpl: () => ({
      auth: { me: async () => { throw new Error("unauthorized"); } },
    }),
  });

  await assert.rejects(verify("valid-token"), InvalidBase44SessionError);
});
