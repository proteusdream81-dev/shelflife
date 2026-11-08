import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyFirebaseBearerToken } from "./firebaseAuth.js";

const projectId = "shelflife-tbr-9754d";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const keyId = "test-signing-key";
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", typ: "JWT", kid: keyId });
  const claims = encode({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: "firebase-test-user",
    iat: now,
    exp: now + 3600,
    auth_time: now,
    email: "reader@example.test",
    email_verified: true,
    name: "Test Reader",
    firebase: { sign_in_provider: "password" },
    ...overrides,
  });
  const signingInput = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function mockGoogleCertificates() {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ [keyId]: publicKeyPem }), {
      status: 200,
      headers: { "cache-control": "public, max-age=3600" },
    });
}

test("accepts a correctly signed token for the configured Firebase project", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  mockGoogleCertificates();

  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken()}` },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.user, {
    uid: "firebase-test-user",
    email: "reader@example.test",
    emailVerified: true,
    displayName: "Test Reader",
  });
});

test("rejects a token with the wrong project audience", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  mockGoogleCertificates();

  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken({ aud: "another-project" })}` },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects a token whose signature has been tampered with", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  mockGoogleCertificates();

  const token = makeToken();
  const [header, payload, signature] = token.split(".");
  const alteredSignature = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${header}.${payload}.${alteredSignature}` },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("fails closed when the configured project is wrong", async () => {
  process.env.FIREBASE_PROJECT_ID = "wrong-project";

  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken()}` },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});


test("rejects a token with the wrong Firebase issuer", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken({ iss: "https://securetoken.google.com/another-project" })}` },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects an expired token", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  const now = Math.floor(Date.now() / 1000);
  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken({ iat: now - 7200, auth_time: now - 7200, exp: now - 3600 })}` },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects a token issued too far in the future", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  const now = Math.floor(Date.now() / 1000);
  const result = await verifyFirebaseBearerToken({
    headers: { authorization: `Bearer ${makeToken({ iat: now + 600, auth_time: now + 600 })}` },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects a request without a bearer token", async () => {
  process.env.FIREBASE_PROJECT_ID = projectId;
  const result = await verifyFirebaseBearerToken({ headers: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
