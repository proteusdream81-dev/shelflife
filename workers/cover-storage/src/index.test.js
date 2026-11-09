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
function token(uid = "reader-1", overrides = {}) {
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
    ...overrides,
  });
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}
function env() {
  const objects = new Map();
  return {
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_API_KEY: "test-firebase-api-key",
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
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const idToken = JSON.parse(init.body).idToken;
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub, disabled: false,
        validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
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

test("uploads a valid JPEG under the authenticated UID and returns a signed read URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const idToken = JSON.parse(init.body).idToken;
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub, disabled: false,
        validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const bindings = env();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token("reader-1")}`, "Content-Type": "image/jpeg", Origin: origin },
      body: jpeg,
    }), bindings);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.match(payload.objectKey, /^reader-1\/[a-f0-9-]+\.jpg$/);
    assert.equal(payload.size, jpeg.length);
    assert.ok(payload.readUrl.includes("/v1/covers/read/"));
    assert.equal(bindings.objects.size, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects Firebase tokens with missing or invalid auth_time claims", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const idToken = JSON.parse(init.body).idToken;
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub, disabled: false,
        validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token("reader-1", { auth_time: "invalid" })}`, "Content-Type": "image/jpeg", Origin: origin },
      body: Buffer.from([0xff,0xd8,0xff]),
    }), env());
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a body larger than 5 MiB without buffering the complete upload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const idToken = JSON.parse(init.body).idToken;
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub, disabled: false,
        validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token("reader-1")}`, "Content-Type": "image/jpeg", Origin: origin },
      body: oversized,
    }), env());
    assert.equal(response.status, 413);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
