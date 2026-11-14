import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseSharingApi, FirebaseSharingApiError } from "./firebaseSharingApi.js";

function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("updates share settings with Firebase auth and an If-Match version", async () => {
  let call;
  const api = createFirebaseSharingApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { shareEnabled: true, shareAudience: "selected", sharedWithUids: ["readerB"] });
    },
  });
  const settings = { enabled: true, audience: "selected", recipientUids: ["readerB"], linkEnabled: false };
  const result = await api.updateShareSettings("books", "book-1", settings, "2026-11-10T00:00:00Z");
  assert.equal(result.shareEnabled, true);
  assert.equal(call.url, "/api/library/books/book-1/sharing");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
  assert.equal(call.options.headers["If-Match"], "2026-11-10T00:00:00Z");
  assert.deepEqual(JSON.parse(call.options.body), settings);
});

test("fetches public share without requiring an authenticated Firebase session", async () => {
  let call;
  const api = createFirebaseSharingApi({
    getToken: async () => { throw new Error("must not request a token"); },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { kind: "book", item: { id: "book-1", title: "Example" } });
    },
  });
  const result = await api.getPublicShare("secure-share-token-123456789");
  assert.equal(result.item.title, "Example");
  assert.equal(call.url, "/api/share/secure-share-token-123456789");
  assert.equal("Authorization" in call.options.headers, false);
});

test("surfaces stale-version conflicts and validates targets", async () => {
  const api = createFirebaseSharingApi({
    getToken: async () => "token",
    fetchImpl: async () => response(409, { error: "Sharing settings changed; reload and try again" }),
  });
  await assert.rejects(api.updateShareSettings("books", "book-1", {}, "v1"), (error) => {
    assert.ok(error instanceof FirebaseSharingApiError);
    assert.equal(error.status, 409);
    return true;
  });
  await assert.rejects(api.updateShareSettings("users", "book-1", {}, "v1"), TypeError);
  await assert.rejects(api.updateShareSettings("books", "book-1", {}, null), TypeError);
});


test("loads the authenticated shared-with-me feed", async () => {
  let call;
  const api = createFirebaseSharingApi({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(200, { count: 1, records: [{ kind: "book", item: { title: "Shared" } }] });
    },
  });
  const result = await api.listSharedWithMe();
  assert.equal(result.count, 1);
  assert.equal(call.url, "/api/shared");
  assert.equal(call.options.headers.Authorization, "Bearer firebase-token");
});
