import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptFollowRequest,
  blockReader,
  createFollowRequest,
  removeFollowRelationship,
  unblockReader,
  relationshipId,
  blockId,
  SocialGraphPermissionError,
  SocialGraphInputError,
  SocialGraphNotFoundError,
} from "./socialGraph.js";

function fakeDb({ profiles = {}, relationships = {}, blocks = {}, identityLinks = {}, legacyIdentityLinks = {} } = {}) {
  const verifiedLinks = structuredClone(identityLinks);
  const explicitIdentityLinks = Object.keys(identityLinks).length > 0;
  for (const uid of Object.keys(profiles)) {
    if (!verifiedLinks[uid] && !explicitIdentityLinks) verifiedLinks[uid] = { status: "verified", base44UserId: "legacy-" + uid };
  }
  const verifiedReverseLinks = structuredClone(legacyIdentityLinks);
  for (const uid of Object.keys(profiles)) {
    if (!verifiedLinks[uid]) continue;
    const base44UserId = verifiedLinks[uid].base44UserId;
    if (!verifiedReverseLinks[base44UserId]) verifiedReverseLinks[base44UserId] = { status: "verified", firebaseUid: uid };
  }
  const state = {
    profiles: structuredClone(profiles),
    identityLinks: verifiedLinks,
    legacyIdentityLinks: verifiedReverseLinks,
    relationships: structuredClone(relationships),
    blocks: structuredClone(blocks),
  };
  const collection = (name) => ({
    doc(id) {
      const bucket = name === "users" ? state.profiles
        : name === "identityLinks" ? state.identityLinks
          : name === "legacyIdentityLinks" ? state.legacyIdentityLinks
            : name === "relationships" ? state.relationships : state.blocks;
      return {
        async get() {
          const value = bucket[id];
          return { exists: value !== undefined, id, updateTime: value?._version || "v1", data: () => value && structuredClone(value) };
        },
        async create(data) {
          if (bucket[id]) { const error = new Error("exists"); error.code = "ALREADY_EXISTS"; throw error; }
          bucket[id] = { ...structuredClone(data), _version: "v2" };
          return { updateTime: "v2" };
        },
        async update(data, { lastUpdateTime } = {}) {
          if (!bucket[id] || bucket[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
          bucket[id] = { ...bucket[id], ...structuredClone(data), _version: "v3" };
          return { updateTime: "v3" };
        },
        async delete({ lastUpdateTime } = {}) {
          if (!bucket[id]) { const error = new Error("missing"); error.code = "NOT_FOUND"; throw error; }
          if (bucket[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
          delete bucket[id];
        },
      };
    },
    where(field, operator, value) {
      const bucket = name === "relationships" ? state.relationships : state.blocks;
      if (operator !== "==" || !["followerUid", "followingUid", "blockerUid", "blockedUid"].includes(field)) {
        throw new TypeError("Unsupported query");
      }
      return {
        limit(maximum) {
          const query = (cursor = null) => ({
            async get() {
              const docs = Object.entries(bucket)
                .filter(([id, row]) => row[field] === value && (cursor === null || id > cursor))
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(0, maximum)
                .map(([id, row]) => ({ id, data: () => structuredClone(row) }));
              return { docs };
            },
          });
          return {
            get: () => query().get(),
            startAfter(cursor) { return query(cursor); },
          };
        },
      };
    },
  });
  return { state, collection };
}

const profiles = {
  readerA: { displayName: "Reader A", profileHidden: false },
  readerB: { displayName: "Reader B", profileHidden: true },
};

test("creates public follow as accepted and private-profile follow as pending", async () => {
  const db = fakeDb({ profiles });
  const publicResult = await createFollowRequest({ db, followerUid: "readerA", followingUid: "readerA2" }).catch(() => null);
  // A missing target profile is rejected before a relationship can be created.
  assert.equal(publicResult, null);

  db.state.profiles.readerB = profiles.readerB;
  const pending = await createFollowRequest({ db, followerUid: "readerA", followingUid: "readerB" });
  assert.equal(pending.status, "pending");
  assert.equal(db.state.relationships[relationshipId("readerA", "readerB")].followerUid, "readerA");

  db.state.profiles.readerC = { displayName: "Reader C", profileHidden: false };
  db.state.identityLinks.readerC = { status: "verified", base44UserId: "legacy-readerC" };
  db.state.legacyIdentityLinks["legacy-readerC"] = { status: "verified", firebaseUid: "readerC" };
  const accepted = await createFollowRequest({ db, followerUid: "readerA", followingUid: "readerC" });
  assert.equal(accepted.status, "accepted");
});

test("accepts a pending follow only by the followed reader", async () => {
  const id = relationshipId("readerA", "readerB");
  const db = fakeDb({ profiles, relationships: { [id]: {
    followerUid: "readerA", followingUid: "readerB", status: "pending", _version: "v1",
  } } });
  await assert.rejects(acceptFollowRequest({ db, relationshipId: id, actorUid: "readerA" }), SocialGraphPermissionError);
  const result = await acceptFollowRequest({ db, relationshipId: id, actorUid: "readerB" });
  assert.equal(result.status, "accepted");
  assert.equal(db.state.relationships[id].status, "accepted");
});

test("removes a relationship only for one of its two participants", async () => {
  const id = relationshipId("readerA", "readerB");
  const db = fakeDb({ relationships: { [id]: {
    followerUid: "readerA", followingUid: "readerB", status: "accepted", _version: "v1",
  } } });
  await assert.rejects(removeFollowRelationship({ db, relationshipId: id, actorUid: "readerC" }), SocialGraphPermissionError);
  assert.deepEqual(await removeFollowRelationship({ db, relationshipId: id, actorUid: "readerA" }), { removed: true });
  assert.equal(db.state.relationships[id], undefined);
});

test("blocks both directions, removes existing follows and prevents new follow requests", async () => {
  const forward = relationshipId("readerA", "readerB");
  const reverse = relationshipId("readerB", "readerA");
  const db = fakeDb({
    profiles,
    relationships: {
      [forward]: { followerUid: "readerA", followingUid: "readerB", status: "accepted", _version: "v1" },
      [reverse]: { followerUid: "readerB", followingUid: "readerA", status: "accepted", _version: "v1" },
    },
  });
  const result = await blockReader({ db, blockerUid: "readerA", blockedUid: "readerB" });
  assert.equal(result.blocked, true);
  assert.equal(db.state.relationships[forward], undefined);
  assert.equal(db.state.relationships[reverse], undefined);
  await assert.rejects(createFollowRequest({ db, followerUid: "readerB", followingUid: "readerA" }), SocialGraphPermissionError);
  assert.equal(db.state.blocks[blockId("readerA", "readerB")].blockerUid, "readerA");
});

test("only the blocker can unblock and an unblocked account can follow again", async () => {
  const id = blockId("readerA", "readerB");
  const db = fakeDb({ profiles, blocks: { [id]: { blockerUid: "readerA", blockedUid: "readerB", _version: "v1" } } });
  assert.deepEqual(await unblockReader({ db, blockerUid: "readerB", blockedUid: "readerA" }), { unblocked: false });
  assert.deepEqual(await unblockReader({ db, blockerUid: "readerA", blockedUid: "readerB" }), { unblocked: true });
  const result = await createFollowRequest({ db, followerUid: "readerA", followingUid: "readerB" });
  assert.equal(result.status, "pending");
});

test("rejects self-follow, malformed UIDs and cross-account relationship IDs", async () => {
  const db = fakeDb({ profiles });
  await assert.rejects(createFollowRequest({ db, followerUid: "readerA", followingUid: "readerA" }), SocialGraphInputError);
  await assert.rejects(createFollowRequest({ db, followerUid: "../bad", followingUid: "readerB" }), SocialGraphInputError);
});


test("lists following and follower records with bounded pagination and no private profile fields", async () => {
  const records = {
    [relationshipId("readerA", "readerB")]: {
      followerUid: "readerA", followingUid: "readerB", status: "accepted", createdAt: "2026-11-10T00:00:00Z",
      privateEmail: "must-not-return@example.test",
    },
    [relationshipId("readerC", "readerA")]: {
      followerUid: "readerC", followingUid: "readerA", status: "pending", createdAt: "2026-11-10T01:00:00Z",
    },
  };
  const calls = [];
  const db = { collection(name) {
    return { doc(id) { return { get: async () => ({ exists: true, data: () => ({ displayName: "Reader " + id }) }) }; }, where(field, op, value) {
      return { limit(limit) {
        return { startAfter(cursor) { calls.push({ name, field, op, value, limit, cursor }); return this; },
          async get() { calls.push({ name, field, op, value, limit }); return { docs: Object.entries(records)
            .filter(([, row]) => row[field] === value).map(([id, row]) => ({ id, data: () => row })) }; } };
      } };
    } };
  } };
  const following = await (await import("./socialGraph.js")).listUserRelationships({ db, uid: "readerA", direction: "following" });
  assert.deepEqual(following.records, [{
    id: relationshipId("readerA", "readerB"), readerUid: "readerB", displayName: "Reader readerB", status: "accepted",
    createdAt: "2026-11-10T00:00:00Z", updatedAt: null,
  }]);
  assert.equal(JSON.stringify(following).includes("must-not-return"), false);
  assert.equal(calls[0].field, "followerUid");
  const followers = await (await import("./socialGraph.js")).listUserRelationships({ db, uid: "readerA", direction: "followers" });
  assert.equal(followers.records[0].readerUid, "readerC");
  assert.equal(calls[3].field, "followingUid");
});

test("rejects a target profile that has no verified legacy identity link", async () => {
  const db = fakeDb({
    profiles,
    identityLinks: {
      readerA: { status: "verified", base44UserId: "legacy-readerA" },
    },
  });
  await assert.rejects(
    createFollowRequest({ db, followerUid: "readerA", followingUid: "readerB" }),
    SocialGraphNotFoundError,
  );
});

test("repeated block calls still clean up relationships left by an earlier partial cleanup", async () => {
  const forward = relationshipId("readerA", "readerB");
  const id = blockId("readerA", "readerB");
  const db = fakeDb({
    profiles,
    blocks: { [id]: { blockerUid: "readerA", blockedUid: "readerB", _version: "v1" } },
    relationships: {
      [forward]: { followerUid: "readerA", followingUid: "readerB", status: "accepted", _version: "v1" },
    },
  });
  const result = await blockReader({ db, blockerUid: "readerA", blockedUid: "readerB" });
  assert.equal(result.alreadyBlocked, true);
  assert.equal(db.state.relationships[forward], undefined);
});

function overviewDb() {
  const profiles = {
    readerA: { displayName: "Reader A" }, readerB: { displayName: "Reader B" },
    readerC: { displayName: "Reader C" }, readerD: { displayName: "Reader D" },
    readerE: { displayName: "Reader E" }, readerF: { displayName: "Reader F" },
    readerG: { displayName: "Reader G" }, readerH: { displayName: "Reader H" },
    readerZ: { displayName: "Reader Z", username: "readerz" },
    readerHidden: { displayName: "Hidden Reader", profileHidden: true },
    readerUnlinked: { displayName: "Unlinked Reader" },
  };
  const relationships = {
    [relationshipId("readerA", "readerB")]: { followerUid: "readerA", followingUid: "readerB", status: "accepted" },
    [relationshipId("readerC", "readerA")]: { followerUid: "readerC", followingUid: "readerA", status: "accepted" },
    [relationshipId("readerA", "readerD")]: { followerUid: "readerA", followingUid: "readerD", status: "pending" },
    [relationshipId("readerE", "readerA")]: { followerUid: "readerE", followingUid: "readerA", status: "pending" },
    [relationshipId("readerA", "readerF")]: { followerUid: "readerA", followingUid: "readerF", status: "accepted" },
    [relationshipId("readerF", "readerA")]: { followerUid: "readerF", followingUid: "readerA", status: "accepted" },
  };
  const blocks = {
    [blockId("readerA", "readerG")]: { blockerUid: "readerA", blockedUid: "readerG" },
    [blockId("readerH", "readerA")]: { blockerUid: "readerH", blockedUid: "readerA" },
  };
  const shelves = [];
  const addShelf = (uid, id, fields = {}) => shelves.push({
    id,
    data: () => ({ shareEnabled: true, shareAudience: "circle", ...fields }),
    ref: { parent: { id: "shelves", parent: { id: uid, parent: { id: "users" } } } },
  });
  addShelf("readerB", "b1"); addShelf("readerB", "b2");
  addShelf("readerB", "b3", { shareAudience: "selected" });
  addShelf("readerB", "b4", { is_private: true });
  addShelf("readerC", "c1"); addShelf("readerD", "d1"); addShelf("readerE", "e1");
  addShelf("readerF", "f1"); addShelf("readerZ", "z1"); addShelf("readerHidden", "h1");
  addShelf("readerG", "g1"); addShelf("readerH", "h2"); addShelf("readerUnlinked", "u1");
  const identities = Object.fromEntries(Object.keys(profiles).filter((uid) => uid !== "readerUnlinked").map((uid) => [uid, `legacy-${uid}`]));
  const makeQuery = (docs, field, value, maximum) => ({
    async get() { return { docs: docs.filter((doc) => doc.data()[field] === value).slice(0, maximum) }; },
  });
  return {
    collection(name) {
      if (name === "users") return { doc(uid) { return { get: async () => ({ exists: Boolean(profiles[uid]), data: () => profiles[uid] }) }; } };
      if (name === "identityLinks") return { doc(uid) { return { get: async () => ({ exists: Boolean(identities[uid]), data: () => ({ status: "verified", base44UserId: identities[uid] }) }) }; } };
      if (name === "legacyIdentityLinks") return { doc(id) { return { get: async () => ({ exists: Object.values(identities).includes(id), data: () => ({ status: "verified", firebaseUid: Object.keys(identities).find((uid) => identities[uid] === id) }) }) }; } };
      if (name === "relationships") return { where(field, operator, value) { return { limit(maximum) { return makeQuery(Object.entries(relationships).map(([id, row]) => ({ id, data: () => row })), field, value, maximum); } }; } };
      if (name === "blocks") return { where(field, operator, value) { return { limit(maximum) { return makeQuery(Object.entries(blocks).map(([id, row]) => ({ id, data: () => row })), field, value, maximum); } }; } };
      throw new Error(`Unexpected collection ${name}`);
    },
    collectionGroup(name) {
      assert.equal(name, "shelves");
      return { where(field, operator, value) {
        return { limit(maximum) {
          return { get: async () => ({ docs: shelves.filter((doc) => doc.data()[field] === value).slice(0, maximum) }) };
        } };
      } };
    },
  };
}

test("builds a privacy-filtered overview with following, followers, requests, blocks and suggestions", async () => {
  const { getReadingCircleOverview } = await import("./socialGraph.js");
  const result = await getReadingCircleOverview({ db: overviewDb(), uid: "readerA" });
  assert.deepEqual(result.following.map((reader) => reader.id), ["readerB", "readerF"]);
  assert.equal(result.following.find((reader) => reader.id === "readerB").shared_shelves, 2);
  assert.deepEqual(result.followers.map((reader) => reader.id), ["readerC", "readerF"]);
  assert.equal(result.followers.find((reader) => reader.id === "readerF").you_follow, true);
  assert.deepEqual(result.requests.map((reader) => reader.id), ["readerE"]);
  assert.deepEqual(result.requested.map((reader) => reader.id), ["readerD"]);
  assert.deepEqual(result.blocked.map((reader) => reader.id), ["readerG"]);
  assert.deepEqual(result.suggested.map((reader) => reader.id), ["readerZ"]);
  assert.equal(result.suggested[0].username, "readerz");
  assert.equal(JSON.stringify(result).includes("readerH"), false);
  assert.equal(JSON.stringify(result).includes("readerHidden"), false);
  assert.equal(JSON.stringify(result).includes("readerUnlinked"), false);
});
