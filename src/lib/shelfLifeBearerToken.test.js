import test from "node:test";
import assert from "node:assert/strict";
import { createShelfLifeBearerTokenProvider } from "./shelfLifeBearerToken.js";

test("prefers Firebase tokens when both identity providers are available", async () => {
  let legacyCalls = 0;
  const getToken = createShelfLifeBearerTokenProvider({
    getFirebaseToken: async () => "firebase-id-token",
    getBase44Token: async () => { legacyCalls += 1; return "base44-token"; },
    isCompatibilityEnabled: () => true,
  });
  assert.equal(await getToken(), "firebase-id-token");
  assert.equal(legacyCalls, 0);
});

test("uses the Base44 session only when the Preview compatibility flag is enabled", async () => {
  const getToken = createShelfLifeBearerTokenProvider({
    getFirebaseToken: async () => null,
    getBase44Token: async () => "base44-session-token",
    isCompatibilityEnabled: () => true,
  });
  assert.equal(await getToken(), "base44-session-token");
});

test("rejects Base44 fallback when compatibility is disabled or token is invalid", async () => {
  const disabled = createShelfLifeBearerTokenProvider({
    getFirebaseToken: async () => null,
    getBase44Token: async () => "base44-session-token",
    isCompatibilityEnabled: () => false,
  });
  await assert.rejects(disabled(), /signed in/);
  const malformed = createShelfLifeBearerTokenProvider({
    getFirebaseToken: async () => null,
    getBase44Token: async () => "bad token",
    isCompatibilityEnabled: () => true,
  });
  await assert.rejects(malformed(), /signed in/);
});

test("does not mask Firebase token retrieval errors with a legacy session", async () => {
  let legacyCalls = 0;
  const getToken = createShelfLifeBearerTokenProvider({
    getFirebaseToken: async () => { throw new Error("Firebase token service unavailable"); },
    getBase44Token: async () => { legacyCalls += 1; return "base44-token"; },
    isCompatibilityEnabled: () => true,
  });
  await assert.rejects(getToken(), /Firebase token service unavailable/);
  assert.equal(legacyCalls, 0);
});
