import test from "node:test";
import assert from "node:assert/strict";
import {
  createFirebaseLibraryApi,
  FirebaseLibraryApiError,
} from "./firebaseLibraryApi.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("lists books with a Firebase bearer token and bounded pagination", async () => {
  const calls = [];
  const api = createFirebaseLibraryApi({
    getToken: async () => "firebase-id-token",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ collection: "books", count: 1, records: [{ id: "book-1" }], nextCursor: null });
    },
  });

  const page = await api.listBooks({ limit: 25, cursor: "book before" });

  assert.equal(page.records[0].id, "book-1");
  assert.match(calls[0].url, /^\/api\/library\/books\?/);
  assert.match(calls[0].url, /limit=25/);
  assert.match(calls[0].url, /cursor=book\+before/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer firebase-id-token");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.method, "GET");
});

test("creates a shelf without allowing the client adapter to supply an owner UID", async () => {
  let call;
  const api = createFirebaseLibraryApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response({ record: { id: "shelf-1", name: "Favourites", version: "2026-11-10T03:00:00Z" } }, 201);
    },
  });

  const shelf = await api.createShelf({ name: "Favourites" });

  assert.equal(shelf.id, "shelf-1");
  assert.equal(call.url, "/api/library/shelves");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.Authorization, "Bearer token");
  assert.deepEqual(JSON.parse(call.options.body), { name: "Favourites" });
  assert.equal("ownerUid" in JSON.parse(call.options.body), false);
});

test("updates a book with the exact version token returned by Firestore", async () => {
  let call;
  const version = "2026-11-10T03:00:00.000000Z";
  const api = createFirebaseLibraryApi({
    getToken: async () => "token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response({ record: { id: "book/one", title: "Updated", version: "2026-11-10T03:01:00Z" } });
    },
  });

  const updated = await api.updateBook({ id: "book/one", version }, { title: "Updated" });

  assert.equal(updated.title, "Updated");
  assert.equal(call.url, "/api/library/books/book%2Fone");
  assert.equal(call.options.method, "PATCH");
  assert.equal(call.options.headers["If-Match"], version);
});

test("rejects missing versions before sending an update", async () => {
  let calls = 0;
  const api = createFirebaseLibraryApi({
    getToken: async () => "token",
    fetchImpl: async () => { calls += 1; return response({ record: {} }); },
  });
  await assert.rejects(
    () => api.updateShelf({ id: "shelf-1" }, { name: "New" }),
    /Reload this record before saving changes/,
  );
  assert.equal(calls, 0);
});

test("surfaces API conflicts with their HTTP status", async () => {
  const api = createFirebaseLibraryApi({
    getToken: async () => "token",
    fetchImpl: async () => response({ error: "Library record changed; reload and try again" }, 409),
  });
  await assert.rejects(
    () => api.updateBook({ id: "book-1", version: "2026-11-10T03:00:00Z" }, { title: "New" }),
    (error) => error instanceof FirebaseLibraryApiError && error.status === 409,
  );
});

test("rejects invalid pagination and record payloads locally", async () => {
  let calls = 0;
  const api = createFirebaseLibraryApi({
    getToken: async () => "token",
    fetchImpl: async () => { calls += 1; return response({}); },
  });
  await assert.rejects(() => api.listBooks({ limit: 101 }), /Page size/);
  await assert.rejects(() => api.createBook([]), /non-empty record object/);
  assert.equal(calls, 0);
});
