import test from "node:test";
import assert from "node:assert/strict";
import {
  closeBookGroup,
  createBookGroup,
  inviteGroupReader,
  leaveBookGroup,
  listBookGroups,
  removeGroupReader,
  respondToGroupInvite,
  GroupMembershipConflictError,
  GroupMembershipInputError,
  GroupMembershipNotFoundError,
  groupInviteId,
  GroupMembershipPermissionError,
} from "./groupMembership.js";

function fakeDb({ profiles = ["ownerA", "readerA", "readerB"], groups = {}, subcollections = {} } = {}) {
  const state = { users: {}, identityLinks: {}, legacyIdentityLinks: {}, groups: structuredClone(groups), subs: structuredClone(subcollections) };
  for (const uid of profiles) {
    state.users[uid] = { displayName: uid };
    state.identityLinks[uid] = { status: "verified", base44UserId: "legacy-" + uid };
    state.legacyIdentityLinks["legacy-" + uid] = { status: "verified", firebaseUid: uid };
  }
  const snapshot = (bucket, id) => {
    const value = bucket[id];
    return { exists: value !== undefined, id, updateTime: value?._version || null, data: () => value && structuredClone(value) };
  };
  const groupRef = (id) => ({
    async get() { return snapshot(state.groups, id); },
    async create(data) {
      if (state.groups[id]) { const error = new Error("exists"); error.code = "ALREADY_EXISTS"; throw error; }
      state.groups[id] = { ...structuredClone(data), _version: "g1" };
      return { updateTime: "g1" };
    },
    async update(data, { lastUpdateTime } = {}) {
      if (!state.groups[id] || state.groups[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
      state.groups[id] = { ...state.groups[id], ...structuredClone(data), _version: "g2" };
      return { updateTime: "g2" };
    },
    async delete({ lastUpdateTime } = {}) {
      if (!state.groups[id] || state.groups[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
      delete state.groups[id];
    },
    collection(name) {
      state.subs[id] ||= {};
      state.subs[id][name] ||= {};
      const bucket = state.subs[id][name];
      return {
        doc(docId) {
          return {
            async get() { return snapshot(bucket, docId); },
            async create(data) {
              if (bucket[docId]) { const error = new Error("exists"); error.code = "ALREADY_EXISTS"; throw error; }
              bucket[docId] = { ...structuredClone(data), _version: "d1" };
              return { updateTime: "d1" };
            },
            async update(data, { lastUpdateTime } = {}) {
              if (!bucket[docId] || bucket[docId]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
              bucket[docId] = { ...bucket[docId], ...structuredClone(data), _version: "d2" };
              return { updateTime: "d2" };
            },
          };
        },
        limit(maximum) {
          return { async get() {
            return { docs: Object.entries(bucket).slice(0, maximum).map(([id, data]) => ({ id, data: () => structuredClone(data) })) };
          } };
        },
      };
    },
  });
  return {
    state,
    collection(name) {
      if (name === "users") return { doc: (id) => ({ get: async () => snapshot(state.users, id) }) };
      if (name === "identityLinks") return { doc: (id) => ({ get: async () => snapshot(state.identityLinks, id) }) };
      if (name === "legacyIdentityLinks") return { doc: (id) => ({ get: async () => snapshot(state.legacyIdentityLinks, id) }) };
      if (name === "groups") return { doc: (id) => groupRef(id) };
      throw new Error("Unexpected collection " + name);
    },
  };
}

const timestamp = () => "2026-11-10T05:00:00.000Z";

test("creates a group and owner membership from allowlisted fields", async () => {
  const db = fakeDb();
  const group = await createBookGroup({
    db, ownerUid: "ownerA",
    input: { name: "Fantasy readers", description: "Read together", category: "Fantasy", location: "Online", bookTitle: "The Hobbit", isPrivate: true },
    createId: () => "group-1", now: timestamp,
  });
  assert.equal(group.ownerUid, "ownerA");
  assert.equal(group.status, "active");
  assert.equal(db.state.subs["group-1"].members.ownerA.role, "owner");
  assert.equal(db.state.subs["group-1"].members.ownerA.status, "active");
});

test("rejects arbitrary group fields and missing identity mappings", async () => {
  const db = fakeDb();
  await assert.rejects(createBookGroup({ db, ownerUid: "ownerA", input: { name: "Test", isPrivate: false, ownerUid: "readerB" } }), GroupMembershipInputError);
  const unmapped = fakeDb({ profiles: ["ownerA", "readerB"], groups: { "group-1": { ownerUid: "ownerA", status: "active", _version: "g1" } } });
  delete unmapped.state.identityLinks.readerB;
  await assert.rejects(inviteGroupReader({ db: unmapped, groupId: "group-1", inviterUid: "ownerA", inviteeUid: "readerB" }), GroupMembershipNotFoundError);
});

test("only the owner can invite verified readers and duplicate pending invitations are idempotent", async () => {
  const db = fakeDb({ groups: { "group-1": { ownerUid: "ownerA", isPrivate: true, status: "active", _version: "g1" } } });
  await assert.rejects(inviteGroupReader({ db, groupId: "group-1", inviterUid: "readerA", inviteeUid: "readerB" }), GroupMembershipPermissionError);
  const first = await inviteGroupReader({ db, groupId: "group-1", inviterUid: "ownerA", inviteeUid: "readerB", now: timestamp });
  const second = await inviteGroupReader({ db, groupId: "group-1", inviterUid: "ownerA", inviteeUid: "readerB", now: timestamp });
  assert.equal(first.status, "pending");
  assert.equal(second.alreadyExists, true);
});

test("invitee alone can accept and retries repair a missing membership", async () => {
  const invite = { inviterUid: "ownerA", inviteeUid: "readerB", status: "pending", _version: "d1" };
  const db = fakeDb({
    groups: { "group-1": { ownerUid: "ownerA", status: "active", _version: "g1" } },
    subcollections: { "group-1": { invites: { [ "a".repeat(64) ]: invite } } },
  });
  await assert.rejects(respondToGroupInvite({ db, groupId: "group-1", inviteId: "a".repeat(64), inviteeUid: "readerA", decision: "accept" }), GroupMembershipPermissionError);
  const result = await respondToGroupInvite({ db, groupId: "group-1", inviteId: "a".repeat(64), inviteeUid: "readerB", decision: "accept", now: timestamp });
  assert.equal(result.accepted, true);
  assert.equal(db.state.subs["group-1"].members.readerB.status, "active");
  const retry = await respondToGroupInvite({ db, groupId: "group-1", inviteId: "a".repeat(64), inviteeUid: "readerB", decision: "accept", now: timestamp });
  assert.equal(retry.alreadyAccepted, true);
});

test("removed readers cannot rejoin and owner removal revokes pending invites", async () => {
  const inviteId = groupInviteId("group-1", "readerB");
  const db = fakeDb({
    groups: { "group-1": { ownerUid: "ownerA", status: "active", _version: "g1" } },
    subcollections: { "group-1": {
      members: { readerA: { uid: "readerA", role: "member", status: "active", _version: "d1" } },
      invites: { [inviteId]: { inviterUid: "ownerA", inviteeUid: "readerB", status: "pending", _version: "d1" } },
    } },
  });
  await removeGroupReader({ db, groupId: "group-1", ownerUid: "ownerA", targetUid: "readerA", now: timestamp });
  assert.equal(db.state.subs["group-1"].removed.readerA.uid, "readerA");
  assert.equal(db.state.subs["group-1"].members.readerA.status, "removed");
  await assert.rejects(inviteGroupReader({ db, groupId: "group-1", inviterUid: "ownerA", inviteeUid: "readerA" }), GroupMembershipConflictError);
  await removeGroupReader({ db, groupId: "group-1", ownerUid: "ownerA", targetUid: "readerB", now: timestamp });
  assert.equal(db.state.subs["group-1"].invites[inviteId].status, "revoked");
});

test("members can leave, owners cannot leave, and only owners can close groups", async () => {
  const db = fakeDb({
    groups: { "group-1": { ownerUid: "ownerA", status: "active", _version: "g1" } },
    subcollections: { "group-1": { members: { readerA: { uid: "readerA", status: "active", _version: "d1" } } } },
  });
  await assert.rejects(leaveBookGroup({ db, groupId: "group-1", uid: "ownerA" }), GroupMembershipPermissionError);
  assert.deepEqual(await leaveBookGroup({ db, groupId: "group-1", uid: "readerA", now: timestamp }), { left: true });
  await assert.rejects(closeBookGroup({ db, groupId: "group-1", ownerUid: "readerA" }), GroupMembershipPermissionError);
  assert.deepEqual(await closeBookGroup({ db, groupId: "group-1", ownerUid: "ownerA", now: timestamp }), { closed: true, groupId: "group-1" });
  assert.equal(db.state.groups["group-1"].status, "closed");
});


test("joins public groups, denies private groups and prevents removed readers rejoining", async () => {
  const db = fakeDb({
    groups: {
      "public-group": { ownerUid: "ownerA", isPrivate: false, status: "active", _version: "g1" },
      "private-group": { ownerUid: "ownerA", isPrivate: true, status: "active", _version: "g1" },
    },
    subcollections: { "public-group": { removed: { readerB: { uid: "readerB" } } } },
  });
  const joined = await (await import("./groupMembership.js")).joinPublicGroup({
    db, groupId: "public-group", uid: "readerA", now: timestamp,
  });
  assert.equal(joined.joined, true);
  assert.equal(db.state.subs["public-group"].members.readerA.status, "active");
  await assert.rejects(
    (await import("./groupMembership.js")).joinPublicGroup({ db, groupId: "private-group", uid: "readerA" }),
    GroupMembershipPermissionError,
  );
  await assert.rejects(
    (await import("./groupMembership.js")).joinPublicGroup({ db, groupId: "public-group", uid: "readerB" }),
    GroupMembershipPermissionError,
  );
});

test("lists safe group roster for members and pending invitations only for owners", async () => {
  const db = fakeDb({
    groups: { "group-1": { ownerUid: "ownerA", isPrivate: true, status: "active", _version: "g1" } },
    subcollections: { "group-1": {
      members: {
        ownerA: { uid: "ownerA", role: "owner", status: "active" },
        readerA: { uid: "readerA", role: "member", status: "active" },
      },
      invites: { invite1: { inviteeUid: "readerB", status: "pending" } },
    } },
  });
  const owner = await (await import("./groupMembership.js")).listGroupRoster({ db, groupId: "group-1", viewerUid: "ownerA" });
  assert.equal(owner.members.length, 2);
  assert.equal(owner.pending[0].id, "readerB");
  assert.equal(JSON.stringify(owner).includes("email"), false);
  const member = await (await import("./groupMembership.js")).listGroupRoster({ db, groupId: "group-1", viewerUid: "readerA" });
  assert.equal(member.members.length, 2);
  assert.deepEqual(member.pending, []);
});


test("lists only public active groups and combines owned and joined group membership safely", async () => {
  const makeGroup = (id, data) => ({
    id,
    ref: { id, get: async () => ({ exists: true, data: () => data }) },
    data: () => data,
  });
  const groupA = makeGroup("groupA", {
    ownerUid: "ownerA", name: "Owner club", isPrivate: true, status: "active",
    createdAt: "2026-11-10T02:00:00Z", secret: "never expose",
  });
  const groupB = makeGroup("groupB", {
    ownerUid: "ownerB", name: "Joined club", isPrivate: true, status: "active",
    createdAt: "2026-11-10T03:00:00Z",
  });
  const groupC = makeGroup("groupC", {
    ownerUid: "ownerC", name: "Public club", isPrivate: false, status: "active",
    createdAt: "2026-11-10T04:00:00Z",
  });
  const refs = { groupA: groupA.ref, groupB: groupB.ref, groupC: groupC.ref };
  const db = {
    collectionGroup(name) {
      return { where(field, operator, uid) {
        assert.equal(name, "members"); assert.equal(field, "uid"); assert.equal(operator, "=="); assert.equal(uid, "readerA");
        return { limit: () => ({ get: async () => ({ docs: [
          { data: () => ({ uid: "readerA", status: "active" }), ref: { parent: { parent: refs.groupB } } },
          { data: () => ({ uid: "readerA", status: "left" }), ref: { parent: { parent: refs.groupC } } },
        ] }) }) };
      } };
    },
    collection(name) {
      assert.equal(name, "groups");
      return {
        where(field, operator, value) {
          return {
            orderBy() { return this; },
            limit: () => ({ get: async () => {
              if (field === "isPrivate") return { docs: [groupC] };
              assert.equal(field, "ownerUid"); assert.equal(operator, "=="); assert.equal(value, "readerA");
              return { docs: [groupA] };
            } }),
          };
        },
        doc(id) { return refs[id]; },
      };
    },
  };
  const mine = await listBookGroups({ db, uid: "readerA", scope: "mine" });
  assert.deepEqual(mine.records.map((row) => [row.id, row.role]).sort(), [["groupA", "owner"], ["groupB", "member"]]);
  assert.equal(JSON.stringify(mine).includes("never expose"), false);
  const publicGroups = await listBookGroups({ db, uid: "readerA", scope: "public" });
  assert.equal(publicGroups.records[0].id, "groupC");
});
