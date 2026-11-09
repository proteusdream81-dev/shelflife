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
  const mutationCounts = new Map();
  return {
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_API_KEY: "test-firebase-api-key",
    ALLOWED_ORIGINS: origin,
    SIGNING_SECRET: "test-signing-secret-that-is-long-enough-for-hmac",
    COVER_MUTATION_LIMITER: {
      async limit({ key }) {
        const count = (mutationCounts.get(key) || 0) + 1;
        mutationCounts.set(key, count);
        return { success: count <= 10 };
      },
    },
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


test("rejects disabled Firebase users and revoked sessions", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const userStatus of [
      { disabled: true, validSince: "0" },
      { disabled: false, validSince: String(Math.floor(Date.now() / 1000) + 120) },
    ]) {
      globalThis.fetch = async (input, init = {}) => {
        if (String(input).includes("accounts:lookup")) {
          return new Response(JSON.stringify({ users: [{
            localId: "reader-1", ...userStatus,
          }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      };
      const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token("reader-1")}`, "Content-Type": "image/jpeg", Origin: origin },
        body: Buffer.from([0xff, 0xd8, 0xff]),
      }), env());
      assert.equal(response.status, 401);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serves a signed read URL and enforces owner-only deletion", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const claims = JSON.parse(Buffer.from(JSON.parse(init.body).idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub, disabled: false, validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const bindings = env();
    const upload = await worker.fetch(new Request("https://worker.test/v1/covers", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token("reader-1")}`, "Content-Type": "image/jpeg", Origin: origin },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    }), bindings);
    const payload = await upload.json();
    assert.equal(upload.status, 201);

    const read = await worker.fetch(new Request(payload.readUrl), bindings);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("content-type"), "image/jpeg");
    assert.equal(read.headers.get("x-content-type-options"), "nosniff");

    const tamperedUrl = new URL(payload.readUrl);
    tamperedUrl.searchParams.set("sig", "short");
    const tamperedRead = await worker.fetch(new Request(tamperedUrl), bindings);
    assert.equal(tamperedRead.status, 403);

    const denied = await worker.fetch(new Request(`https://worker.test/v1/covers/${payload.objectKey}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token("reader-2")}`, Origin: origin },
    }), bindings);
    assert.equal(denied.status, 403);

    const deleted = await worker.fetch(new Request(`https://worker.test/v1/covers/${payload.objectKey}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token("reader-1")}`, Origin: origin },
    }), bindings);
    assert.equal(deleted.status, 204);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("rejects malformed percent-encoding in a signed read path without returning 500", async () => {
  const response = await worker.fetch(new Request(
    "https://worker.test/v1/covers/read/%E0%A4%A?expires=9999999999&sig=invalid"
  ), env());
  assert.equal(response.status, 400);
});

test("rate-limits authenticated cover mutations by Firebase UID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).includes("accounts:lookup")) {
      const idToken = JSON.parse(init.body).idToken;
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
      return new Response(JSON.stringify({ users: [{
        localId: claims.sub,
        disabled: false,
        validSince: String(claims.auth_time - 60),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const bindings = env();
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await worker.fetch(new Request("https://worker.test/v1/covers", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token("reader-rate-limited")}`,
          "Content-Type": "image/jpeg",
          Origin: origin,
        },
        body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }), bindings);
      statuses.push(response.status);
    }
    assert.equal(statuses.filter((status) => status === 201).length, 10);
    assert.equal(statuses[10], 429);
    assert.equal(bindings.objects.size, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
