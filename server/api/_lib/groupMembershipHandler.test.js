import test from "node:test";
import assert from "node:assert/strict";
import { createGroupMembershipHandler } from "./groupMembershipHandler.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;},
  };
}
const auth = async () => ({ ok: true, user: { uid: "ownerA", emailVerified: true } });

test("invite route rejects client-selected inviter or status fields", async () => {
  const res = response();
  await createGroupMembershipHandler({
    operation: "invite",
    verifyToken: auth,
    getDb: async () => { throw new Error("Database must not be opened"); },
  })({ method: "POST", query: { id: "group-1" }, body: { inviteeUid: "readerA", inviterUid: "other", status: "accepted" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Only inviteeUid is accepted" });
});

test("invite response accepts only the decision field", async () => {
  const res = response();
  await createGroupMembershipHandler({
    operation: "respond",
    verifyToken: auth,
    getDb: async () => { throw new Error("Database must not be opened"); },
  })({ method: "PATCH", query: { id: "group-1", inviteId: "invite-1" }, body: { decision: "accept", inviteeUid: "other" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Only decision is accepted" });
});

test("requires verified email before opening group membership storage", async () => {
  const res = response();
  let calls = 0;
  await createGroupMembershipHandler({
    operation: "create",
    verifyToken: async () => ({ ok: true, user: { uid: "ownerA", emailVerified: false } }),
    getDb: async () => { calls += 1; return {}; },
  })({ method: "POST", body: { name: "Test", isPrivate: true } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls, 0);
});
