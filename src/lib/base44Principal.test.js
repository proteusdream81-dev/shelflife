import test from "node:test";
import assert from "node:assert/strict";
import { deriveBase44FirestoreUid } from "./base44Principal.js";

test("derives the same principal UID as the server migration planner", async () => {
  assert.equal(
    await deriveBase44FirestoreUid("legacy-a"),
    "b44_" + "e5bff6e62e7b76b84c4a6b8c89c88b4cbba8a0c4c28dbe6bfb4a98a1b6dbbe7d"
  );
});

test("rejects malformed Base44 IDs", async () => {
  await assert.rejects(deriveBase44FirestoreUid(""), /valid Base44 user ID/);
  await assert.rejects(deriveBase44FirestoreUid("bad/id"), /valid Base44 user ID/);
  await assert.rejects(deriveBase44FirestoreUid("x".repeat(129)), /valid Base44 user ID/);
});
