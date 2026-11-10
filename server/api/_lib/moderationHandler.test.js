import test from "node:test";
import assert from "node:assert/strict";
import { createModerationHandler } from "./moderationHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const auth = async () => ({ ok: true, user: { uid: "moderatorA", emailVerified: true } });

test("moderation queue is restricted to server-configured moderator UIDs", async () => {
  const denied = response();
  await createModerationHandler({
    operation: "list", verifyToken: auth, moderatorUids: new Set(),
  })({ method: "GET" }, denied);
  assert.equal(denied.statusCode, 403);
  const allowed = response();
  await createModerationHandler({
    operation: "list", verifyToken: auth, moderatorUids: new Set(["moderatorA"]),
    getDb: async () => ({}), resolveProfile: async () => ({}),
    listReports: async () => ({ count: 0, records: [] }),
  })({ method: "GET" }, allowed);
  assert.equal(allowed.statusCode, 200);
});

test("moderator resolve requires a report version and ignores client-selected reviewer IDs", async () => {
  const missing = response();
  await createModerationHandler({
    operation: "resolve", verifyToken: auth, moderatorUids: new Set(["moderatorA"]),
  })({ method: "PATCH", query: { id: "report-1" }, headers: {}, body: { action: "dismiss" } }, missing);
  assert.equal(missing.statusCode, 428);
  const res = response();
  let args;
  await createModerationHandler({
    operation: "resolve", verifyToken: auth, moderatorUids: new Set(["moderatorA"]),
    getDb: async () => ({}), resolveProfile: async () => ({}),
    resolveReport: async (input) => { args = input; return { status: "dismissed" }; },
  })({
    method: "PATCH", query: { id: "report-1" }, headers: { "if-match": "v1" },
    body: { action: "dismiss", moderatorUid: "attacker" },
  }, res);
  assert.equal(res.statusCode, 400);
  const good = response();
  await createModerationHandler({
    operation: "resolve", verifyToken: auth, moderatorUids: new Set(["moderatorA"]),
    getDb: async () => ({}), resolveProfile: async () => ({}),
    resolveReport: async (input) => { args = input; return { status: "dismissed" }; },
  })({
    method: "PATCH", query: { id: "report-1" }, headers: { "if-match": "v1" },
    body: { action: "dismiss" },
  }, good);
  assert.equal(good.statusCode, 200);
  assert.equal(args.moderatorUid, "moderatorA");
});
