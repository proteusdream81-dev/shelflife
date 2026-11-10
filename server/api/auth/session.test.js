import test from "node:test";
import assert from "node:assert/strict";
import handler from "./session.js";

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("session probe is POST-only and does not disclose data on other methods", async () => {
  const res = mockResponse();
  await handler({ method: "GET", headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(res.body, { error: "Method not allowed" });
});

test("session probe rejects requests without a bearer token", async () => {
  const previous = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = "shelflife-tbr-9754d";
  try {
    const res = mockResponse();
    await handler({ method: "POST", headers: {} }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(res.body, { error: "Unauthorized" });
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previous;
  }
});
