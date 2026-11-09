import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import worker from "./index.js";

const projectId = "shelflife-tbr-9754d";
const origin = "https://preview.shelflifetbr.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "worker-test-key";
jwk.alg = "RS256";
jwk.use = "sig";

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function token(uid = "reader-1") {
  const header = b64({ alg: "RS256", typ: "JWT", kid: jwk.kid });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now - 10,
    firebase: { sign_in_provider: "password" },
  });
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}
function env() {
  const objects = new Map();
  return {
    FIREBASE_PROJECT_ID: projectId,
    ALLOWED_ORIGINS: origin,
    SIGNING_SECRET: "test-signing-secret-that-is-long-enough-for-hmac",
    COVERS: {
      async put(key, value, options) { objects.set(key, { value, options }); },
      async get(key) {
        const item = objects.get(key);
        if (!item) return null;
        return {
          body: item.value,
          httpEtag: '"test-etag"',
          writeHttpMetadata(headers) { headers.set("content-type", item.options.httpMetadata.contentType); },
        };
      },
      async delete(key) { objects.delete(key); },
    },
    objects,
  };
}

test("health endpoint responds without authentication", async () => {
  const response = await worker.fetch(new Request("https://worker.test/health"), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", storage: "bound" });
});

test("rejects upload without Firebase bearer token", async () => {
  const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
    method: "PUT", headers: { "Content-Type": "image/jpeg", Origin: origin }, body: Buffer.from([0xff,0xd8,0xff]),
  }), env());
  assert.equal(response.status, 401);
});

test("rejects unapproved browser origins", async () => {
  const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
    method: "OPTIONS", headers: { Origin: "https://evil.example" },
  }), env());
  assert.equal(response.status, 403);
});

test("rejects invalid image signatures after authenticating", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  try {
    const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "image/jpeg", Origin: origin },
      body: Buffer.from("not-a-jpeg"),
    }), env());
    assert.equal(response.status, 415);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
