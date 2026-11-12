import test from "node:test";
import assert from "node:assert/strict";
import handler, { resolveApiRoute } from "../[...path].js";

test("resolves static group routes before dynamic group IDs", () => {
  assert.ok(resolveApiRoute("/api/groups/invites"));
  assert.ok(resolveApiRoute("/api/groups/messages"));
  assert.ok(resolveApiRoute("/api/groups"));
});
test("maps nested group identifiers", () => {
  assert.deepEqual(resolveApiRoute("/api/groups/group-1/messages/message-2")?.params, { id: "group-1", messageId: "message-2" });
  assert.deepEqual(resolveApiRoute("/api/groups/group-1/members/reader-3")?.params, { id: "group-1", uid: "reader-3" });
});
test("maps book and moderation identifiers", () => {
  assert.deepEqual(resolveApiRoute("/api/library/books/book-1/cover")?.params, { id: "book-1" });
  assert.deepEqual(resolveApiRoute("/api/moderation/reports/report-1")?.params, { id: "report-1" });
});
test("resolves the dev-only WIF smoke-test route", () => {
  assert.ok(resolveApiRoute("/api/migration/wif-smoke-test"));
});

test("maps public share token route", () => {
  assert.deepEqual(resolveApiRoute("/api/share/share-token-1234567890")?.params, { token: "share-token-1234567890" });
});
test("returns null for unknown routes and rejects malformed path parameters", () => {
  assert.equal(resolveApiRoute("/api/not-a-route"), null);
  assert.deepEqual(resolveApiRoute("/api/groups/%E0%A4%A"), { malformed: true });
});

test("routes Vercel splat rewrites through the path query parameter", async () => {
  const req = { url: "/api/router?path=health", query: { path: "health" } };
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, "shelflife-api");
});


test("maps an authenticated shared reader library route", () => {
  assert.deepEqual(resolveApiRoute("/api/reading-circle/reader-1/library")?.params, { uid: "reader-1" });
});
