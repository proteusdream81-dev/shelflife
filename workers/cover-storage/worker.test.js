import test from "node:test";
import assert from "node:assert/strict";
import { createCoverWorker } from "./src/index.js";

const token = "firebase-test-token";
const uid = "firebase-reader";
const bookId = "book-1";
const secret = "test-signing-secret-that-is-at-least-32-bytes";
const nowValue = 1794276000000;

function createEnv({ origin = "https://app-preview.example" } = {}) {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    env: {
      FIREBASE_PROJECT_ID: "shelflife-tbr-9754d",
      COVER_STORAGE_WRITES_ENABLED: "true",
      AUTHORIZATION_API_URL: "https://app-preview.example/api/covers/authorize",
      COVER_URL_SIGNING_SECRET: secret,
      ALLOWED_ORIGINS: origin,
      COVER_BUCKET: {
        async put(key, value, options) {
          calls.push({ method: "put", key, options });
          objects.set(key, {
            bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
            httpMetadata: options.httpMetadata,
            customMetadata: options.customMetadata,
          });
        },
        async head(key) {
          return objects.has(key) ? { key } : null;
        },
        async get(key) {
          const object = objects.get(key);
          return object ? {
            body: new Response(object.bytes).body,
            httpMetadata: object.httpMetadata,
            customMetadata: object.customMetadata,
          } : null;
        },
        async delete(key) {
          calls.push({ method: "delete", key });
          objects.delete(key);
        },
      },
    },
  };
}

function makeWorker(state, { now = () => nowValue, authorize = true } = {}) {
  const worker = createCoverWorker({
    now,
    verifyToken: async (value) => value === token ? { sub: uid, email_verified: true } : null,
    fetchImpl: async (url, options) => {
      state.calls.push({ method: "authorize", url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        authorized: authorize,
        bookId: JSON.parse(options.body).bookId,
      }), { status: authorize ? 200 : 403, headers: { "Content-Type": "application/json" } });
    },
  });
  return worker;
}

function authHeaders(extra = {}) {
  return { Authorization: "Bearer " + token, ...extra };
}

test("uploads bounded JPEG bytes only after book ownership authorization", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
  const response = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({
      "X-Book-Id": bookId,
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      Origin: "https://app-preview.example",
    }),
    body: bytes,
  }), state.env);
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.bookId, bookId);
  assert.match(payload.objectKey, new RegExp("^" + uid + "/[0-9a-f-]+\\.jpg$"));
  assert.match(payload.readUrl, /^https:\/\/covers\.example\/v1\/covers\/read\//);
  assert.equal(state.calls[0].method, "authorize");
  assert.equal(state.calls[0].body.bookId, bookId);
  assert.equal(state.objects.size, 1);
  const stored = state.objects.get(payload.objectKey);
  assert.equal(stored.httpMetadata.contentType, "image/jpeg");
  assert.equal(stored.customMetadata.ownerUid, uid);
});

test("rejects unauthenticated uploads and unauthorized books", async () => {
  const state = createEnv();
  const worker = makeWorker(state, { authorize: false });
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  const noToken = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT", headers: { "X-Book-Id": bookId, "Content-Type": "image/jpeg" }, body: bytes,
  }), state.env);
  assert.equal(noToken.status, 401);
  const denied = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: bytes,
  }), state.env);
  assert.equal(denied.status, 403);
  assert.equal(state.objects.size, 0);
});

test("rejects oversized, unsupported and MIME-mismatched image bodies", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const tooLarge = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg", "Content-Length": String(5 * 1024 * 1024 + 1) }),
    body: new Uint8Array([0xff, 0xd8, 0xff]),
  }), state.env);
  assert.equal(tooLarge.status, 413);

  const unsupported = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/svg+xml" }),
    body: "<svg/>",
  }), state.env);
  assert.equal(unsupported.status, 415);

  const mismatch = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }), state.env);
  assert.equal(mismatch.status, 415);
  assert.equal(state.objects.size, 0);
});

test("issues short-lived signed read URLs only for the exact stored cover key", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const key = uid + "/550e8400-e29b-41d4-a716-446655440000.webp";
  state.objects.set(key, {
    bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    httpMetadata: { contentType: "image/webp" },
  });
  const response = await worker.fetch(new Request("https://covers.example/v1/covers/read-url", {
    method: "POST",
    headers: authHeaders({ "X-Book-Id": bookId, "X-Object-Key": key, Origin: "https://app-preview.example" }),
  }), state.env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.bookId, bookId);
  assert.match(payload.readUrl, /exp=/);
  assert.match(payload.readUrl, /sig=/);
  assert.deepEqual(state.calls[0].body, { bookId, objectKey: key });
});

test("serves a signed private object and rejects expired or tampered signatures", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  const upload = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: bytes,
  }), state.env);
  const payload = await upload.json();
  const read = await worker.fetch(new Request(payload.readUrl), state.env);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("Cache-Control"), "private, max-age=60");
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), bytes);

  const expiredWorker = makeWorker(state, { now: () => nowValue + 400000 });
  const expired = await expiredWorker.fetch(new Request(payload.readUrl), state.env);
  assert.equal(expired.status, 403);

  const tampered = new URL(payload.readUrl);
  tampered.searchParams.set("sig", "invalid-signature");
  const invalid = await worker.fetch(new Request(tampered), state.env);
  assert.equal(invalid.status, 403);
});

test("deletes only objects under the authenticated UID prefix", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const ownKey = uid + "/550e8400-e29b-41d4-a716-446655440000.jpg";
  const otherKey = "other-reader/550e8400-e29b-41d4-a716-446655440000.jpg";
  state.objects.set(ownKey, { bytes: new Uint8Array([1]), httpMetadata: { contentType: "image/jpeg" } });
  const denied = await worker.fetch(new Request("https://covers.example/v1/covers/" + encodeURIComponent(otherKey), {
    method: "DELETE", headers: authHeaders(),
  }), state.env);
  assert.equal(denied.status, 403);
  assert.equal(state.objects.has(ownKey), true);

  const deleted = await worker.fetch(new Request("https://covers.example/v1/covers/" + encodeURIComponent(ownKey), {
    method: "DELETE", headers: authHeaders(),
  }), state.env);
  assert.equal(deleted.status, 204);
  assert.equal(state.objects.has(ownKey), false);
});

test("enforces exact browser origins and supports preflight", async () => {
  const state = createEnv();
  const worker = makeWorker(state);
  const denied = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" },
  }), state.env);
  assert.equal(denied.status, 403);

  const allowed = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "OPTIONS",
    headers: { Origin: "https://app-preview.example" },
  }), state.env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://app-preview.example");
});

test("fails closed without authorization configuration or signing secret before uploading", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  const missingAuthorization = createEnv();
  delete missingAuthorization.env.AUTHORIZATION_API_URL;
  const authWorker = makeWorker(missingAuthorization);
  const authResponse = await authWorker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: bytes,
  }), missingAuthorization.env);
  assert.equal(authResponse.status, 503);
  assert.equal(missingAuthorization.objects.size, 0);

  const missingSigning = createEnv();
  delete missingSigning.env.COVER_URL_SIGNING_SECRET;
  const signingWorker = makeWorker(missingSigning);
  const signingResponse = await signingWorker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: bytes,
  }), missingSigning.env);
  assert.equal(signingResponse.status, 503);
  assert.equal(missingSigning.objects.size, 0);
});


test("blocks R2 uploads and deletes when the explicit worker write flag is absent", async () => {
  const state = createEnv();
  delete state.env.COVER_STORAGE_WRITES_ENABLED;
  const worker = makeWorker(state);
  const key = uid + "/550e8400-e29b-41d4-a716-446655440000.jpg";
  state.objects.set(key, { bytes: new Uint8Array([1]), httpMetadata: { contentType: "image/jpeg" } });

  const upload = await worker.fetch(new Request("https://covers.example/v1/covers", {
    method: "PUT",
    headers: authHeaders({ "X-Book-Id": bookId, "Content-Type": "image/jpeg" }),
    body: new Uint8Array([0xff, 0xd8, 0xff]),
  }), state.env);
  assert.equal(upload.status, 503);
  assert.equal(state.objects.size, 1);
  assert.equal(state.calls.length, 0);

  const deletion = await worker.fetch(new Request("https://covers.example/v1/covers/" + encodeURIComponent(key), {
    method: "DELETE",
    headers: authHeaders(),
  }), state.env);
  assert.equal(deletion.status, 503);
  assert.equal(state.objects.has(key), true);
  assert.equal(state.calls.length, 0);
});
