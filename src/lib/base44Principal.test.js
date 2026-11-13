import test from "node:test";
import assert from "node:assert/strict";
import { deriveBase44FirestoreUid } from "./base44Principal.js";

test("derives the same principal UID as the server migration planner", async () => {
  assert.equal(
    await deriveBase44FirestoreUid("legacy-a"),
    "b44_" + "95bde9f9c38a306db8a7093242f7dc126ae0a3dd7e9a07756a11fc18c3f9e8fd"
  );
});

test("rejects malformed Base44 IDs", async () => {
  await assert.rejects(deriveBase44FirestoreUid(""), /valid Base44 user ID/);
  await assert.rejects(deriveBase44FirestoreUid("bad/id"), /valid Base44 user ID/);
  await assert.rejects(deriveBase44FirestoreUid("x".repeat(129)), /valid Base44 user ID/);
});
