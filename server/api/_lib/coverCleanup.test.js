import test from "node:test";
import assert from "node:assert/strict";
import { deleteCoverObject } from "./coverCleanup.js";

const uid = "firebase-reader";
const key = uid + "/123e4567-e89b-42d3-a456-426614174000.jpg";

test("deletes an owner-scoped R2 object using the authenticated Firebase bearer token", async () => {
  let call;
  const deleted = await deleteCoverObject({
    workerUrl: "https://covers.example.workers.dev",
    objectKey: key, uid, bearerToken: "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, status: 204 };
    },
  });
  assert.equal(deleted, true);
  assert.equal(call.url, "https://covers.example.workers.dev/v1/covers/" + encodeURIComponent(key));
  assert.equal(call.options.method, "DELETE");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
});

test("treats an already missing object as cleaned and rejects unsafe keys or URLs", async () => {
  assert.equal(await deleteCoverObject({
    workerUrl: "https://covers.example.workers.dev", objectKey: key, uid, bearerToken: "token",
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), true);
  assert.equal(await deleteCoverObject({
    workerUrl: "http://covers.example.workers.dev", objectKey: key, uid, bearerToken: "token",
  }), false);
  assert.equal(await deleteCoverObject({
    workerUrl: "https://covers.example.workers.dev", objectKey: "other/" + key, uid, bearerToken: "token",
  }), false);
});
