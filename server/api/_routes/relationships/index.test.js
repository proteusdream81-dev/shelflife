import test from "node:test";
import assert from "node:assert/strict";
import { resolveReadingCircleOperation } from "./index.js";

test("routes the legacy overview action to the overview API", () => {
  assert.equal(resolveReadingCircleOperation({ method: "GET", query: { overview: "true" } }), "overview");
});

test("routes exact email, username, name and availability queries to search", () => {
  for (const query of [
    { email: "reader@example.test" }, { username: "reader_name" },
    { name: "Reader Name" }, { checkUsername: "reader_name" },
  ]) assert.equal(resolveReadingCircleOperation({ method: "GET", query }), "search");
});

test("routes ordinary GET requests to list and non-GET requests to follow", () => {
  assert.equal(resolveReadingCircleOperation({ method: "GET", query: {} }), "list");
  assert.equal(resolveReadingCircleOperation({ method: "POST", query: {} }), "follow");
});
