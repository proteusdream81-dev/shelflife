import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseCoverApi } from "./firebaseCoverApi.js";

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const baseBook = { id: "book-1", version: "2026-11-10T03:00:00.000Z" };
const newKey = "firebase-reader/550e8400-e29b-41d4-a716-446655440000.webp";
const oldKey = "firebase-reader/550e8400-e29b-41d4-a716-446655440001.jpg";
const worker = "https://covers.example.workers.dev";

test("refreshes a signed read URL using the authenticated book and object key", async () => {
  let call;
  const api = createFirebaseCoverApi({
    workerUrl: worker,
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response({ bookId: "book-1", readUrl: "https://covers.example.workers.dev/v1/covers/read/key?sig=x" });
    },
  });
  const url = await api.refreshReadUrl({ ...baseBook, cover_storage_key: oldKey });
  assert.equal(url, "https://covers.example.workers.dev/v1/covers/read/key?sig=x");
  assert.equal(call.url, "https://covers.example.workers.dev/v1/covers/read-url");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
  assert.equal(call.options.headers["X-Book-Id"], "book-1");
  assert.equal(call.options.headers["X-Object-Key"], oldKey);
});

test("uploads then persists the object key with the exact book version and cleans up the previous key", async () => {
  const calls = [];
  const api = createFirebaseCoverApi({
    workerUrl: worker,
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/v1/covers") && options.method === "PUT") {
        return response({ bookId: "book-1", objectKey: newKey, readUrl: "https://covers.example.workers.dev/read/new" }, 201);
      }
      if (url === "/api/library/books/book-1/cover") {
        return response({ record: { id: "book-1", cover_storage_key: newKey, version: "2026-11-10T04:00:00.000Z" } });
      }
      if (options.method === "DELETE") return response(null, 204);
      throw new Error("Unexpected request");
    },
  });
  const file = new Blob(["image"], { type: "image/webp" });
  const result = await api.uploadCover({ ...baseBook, cover_storage_key: oldKey }, file);

  assert.equal(calls[0].url, "https://covers.example.workers.dev/v1/covers");
  assert.equal(calls[0].options.headers["X-Book-Id"], "book-1");
  assert.equal(calls[1].options.headers["If-Match"], baseBook.version);
  assert.deepEqual(JSON.parse(calls[1].options.body), { objectKey: newKey });
  assert.equal(calls[2].url, `https://covers.example.workers.dev/v1/covers/${encodeURIComponent(oldKey)}`);
  assert.equal(result.record.cover_storage_key, newKey);
  assert.equal(result.cleanupWarning, false);
});

test("removes a newly uploaded object if the Firestore pointer write fails", async () => {
  const calls = [];
  const api = createFirebaseCoverApi({
    workerUrl: worker,
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/v1/covers") && options.method === "PUT") {
        return response({ bookId: "book-1", objectKey: newKey, readUrl: "https://covers.example.workers.dev/read/new" }, 201);
      }
      if (url === "/api/library/books/book-1/cover") return response({ error: "Version conflict" }, 409);
      if (options.method === "DELETE") return response(null, 204);
      throw new Error("Unexpected request");
    },
  });
  await assert.rejects(() => api.uploadCover(baseBook, new Blob(["image"], { type: "image/webp" })), /Version conflict/);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.method, "DELETE");
});

test("rejects invalid file types and oversize files before network requests", async () => {
  let calls = 0;
  const api = createFirebaseCoverApi({
    workerUrl: worker,
    getToken: async () => "firebase-token",
    fetchImpl: async () => { calls += 1; return response({}); },
  });
  await assert.rejects(() => api.uploadCover(baseBook, new Blob(["x"], { type: "image/gif" })), /Only JPEG/);
  const tooLarge = { size: 5 * 1024 * 1024 + 1, type: "image/jpeg" };
  await assert.rejects(() => api.uploadCover(baseBook, tooLarge), /5 MiB/);
  assert.equal(calls, 0);
});

test("rejects mismatched Worker book IDs and malformed object keys", async () => {
  const api = createFirebaseCoverApi({
    workerUrl: worker,
    getToken: async () => "firebase-token",
    fetchImpl: async () => response({ bookId: "other-book", objectKey: newKey, readUrl: "https://covers.example/read" }, 201),
  });
  await assert.rejects(() => api.uploadCover(baseBook, new Blob(["x"], { type: "image/webp" })), /invalid upload response/);
  await assert.rejects(() => api.refreshReadUrl({ ...baseBook, cover_storage_key: "other-reader/not-a-key" }), /Invalid cover object key/);
});

test("requires a configured HTTPS Worker origin and a current book version", () => {
  assert.throws(() => createFirebaseCoverApi({ workerUrl: "http://covers.example" }), /HTTPS origin/);
  assert.throws(() => createFirebaseCoverApi({ workerUrl: "" }), /not configured/);
  const api = createFirebaseCoverApi({ workerUrl: worker });
  assert.rejects(() => api.refreshReadUrl({ id: "book-1" }), /current version/);
});
