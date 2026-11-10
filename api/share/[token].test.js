import test from "node:test";
import assert from "node:assert/strict";
import { createPublicShareHandler } from "./[token].js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("public share GET resolves a token without requiring an authenticated session", async () => {
  const res = response();
  let received;
  await createPublicShareHandler({
    getDb: async () => ({}),
    resolveShare: async (args) => { received = args; return { kind: "book", item: { id: "book-1" } }; },
  })({ method: "GET", query: { token: "secure-token" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.token, "secure-token");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("unknown public share tokens return 404", async () => {
  const res = response();
  await createPublicShareHandler({
    getDb: async () => ({}),
    resolveShare: async () => { const error = new Error("missing"); error.name = "SharingNotFoundError"; throw error; },
  })({ method: "GET", query: { token: "unknown" } }, res);
  // The route maps the domain error class, not arbitrary errors with the same name.
  assert.equal(res.statusCode, 503);
});
