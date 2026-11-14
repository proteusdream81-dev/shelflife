import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipBase44Bootstrap } from "./authBootstrap.js";

test("isolated Firebase feature previews skip Base44 bootstrap", () => {
  for (const path of [
    "/firebase-auth-preview",
    "/firebase-groups-preview",
    "/firebase-library-preview",
  ]) {
    assert.equal(shouldSkipBase44Bootstrap(path), true, path);
  }
});

test("identity-link preview retains Base44 bootstrap for dual-session proof", () => {
  assert.equal(shouldSkipBase44Bootstrap("/firebase-link-preview"), false);
});

test("ordinary application routes retain Base44 bootstrap", () => {
  assert.equal(shouldSkipBase44Bootstrap("/"), false);
  assert.equal(shouldSkipBase44Bootstrap("/login"), false);
});
