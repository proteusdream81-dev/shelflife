import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  updateShareSettings, resolvePublicShare,
  SharingInputError, SharingPermissionError, SharingConflictError, SharingNotFoundError,
} from "./firestoreSharing.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fakeDb({ collection = "books", item = {}, oldLinks = {}, relationships = {}, blocks = {} } = {}) {
  const state = {
    item: { title: "Shared title", author: "Author", notes: "private note", is_private: false, ...structuredClone(item) },
    itemVersion: "v1",
    shareLinks: structuredClone(oldLinks),
    relationships: structuredClone(relationships),
    blocks: structuredClone(blocks),
  };
  const identities = {
    ownerA: "legacy-ownerA",
    readerB: "legacy-readerB",
  };
  const userRef = (uid) => ({
    async get() { return { exists: true, data: () => ({ displayName: uid }) }; },
    collection(name) {
      if (name !== collection && name !== "books" && name !== "shelves") throw new Error("Unexpected user collection " + name);
      return { doc(id) {
        return {
          async get() {
            return { exists: id === "item-1" && name === collection, updateTime: state.itemVersion, data: () => structuredClone(state.item) };
          },
        };
      }, limit(maximum) {
        return { get: async () => ({ docs: [] }) };
      } };
    },
  });
  return {
    state,
    collection(name) {
      if (name === "users") return { doc: userRef };
      if (name === "identityLinks") return { doc(uid) { return { get: async () => ({
        exists: Boolean(identities[uid]), data: () => ({ status: "verified", base44UserId: identities[uid] }),
      }) }; } };
      if (name === "legacyIdentityLinks") return { doc(id) { return { get: async () => ({
        exists: Object.values(identities).includes(id),
        data: () => ({ status: "verified", firebaseUid: Object.keys(identities).find((uid) => identities[uid] === id) }),
      }) }; } };
      if (name === "relationships" || name === "blocks" || name === "shareLinks") {
        const bucket = name === "relationships" ? state.relationships : name === "blocks" ? state.blocks : state.shareLinks;
        return { doc(id) { return { async get() {
          const data = bucket[id];
          return { exists: data !== undefined, updateTime: data?._version || "v1", data: () => data && structuredClone(data) };
        } }; } };
      }
      throw new Error("Unexpected collection " + name);
    },
    async commitWrites(writes) {
      for (const write of writes) {
        const parts = write.path?.split("/") || [];
        if (write.type === "update" && parts[0] === "users") {
          state.item = { ...state.item, ...structuredClone(write.data) };
          state.itemVersion = "v2";
        } else if (write.type === "create" && parts[0] === "shareLinks") {
          state.shareLinks[parts[1]] = { ...structuredClone(write.data), _version: "v2" };
        } else if (write.type === "update" && parts[0] === "shareLinks") {
          state.shareLinks[parts[1]] = { ...state.shareLinks[parts[1]], ...structuredClone(write.data), _version: "v2" };
        }
      }
      return { writeResults: [{ updateTime: state.itemVersion }] };
    },
  };
}
function circleRelationship(ownerUid, readerUid) {
  return { [hash(ownerUid + "\0" + readerUid)]: { followerUid: ownerUid, followingUid: readerUid, status: "accepted" } };
}

test("selected sharing accepts only verified readers in the active circle", async () => {
  const db = fakeDb({ relationships: circleRelationship("ownerA", "readerB") });
  const result = await updateShareSettings({
    db, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "selected", recipientUids: ["readerB"], linkEnabled: false },
  });
  assert.equal(result.shareEnabled, true);
  assert.deepEqual(result.sharedWithUids, ["readerB"]);
  assert.equal(result.shareLinkEnabled, false);
  assert.equal(db.state.item.shareAudience, "selected");
  assert.equal(db.state.item.shareLinkId, null);
});

test("creates hashed public link atomically and resolves only safe public fields", async () => {
  const db = fakeDb({ item: { spice_rating: 4, spice_shared: false } });
  const result = await updateShareSettings({
    db, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "circle", recipientUids: [], linkEnabled: true },
    createToken: () => "a-secure-test-share-token-123456",
    now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.shareLinkToken, "a-secure-test-share-token-123456");
  const resolved = await resolvePublicShare({ db, token: result.shareLinkToken });
  assert.equal(resolved.kind, "book");
  assert.equal(resolved.item.title, "Shared title");
  assert.equal("notes" in resolved.item, false);
  assert.equal("spice_rating" in resolved.item, false);
  assert.equal(db.state.shareLinks[hash(result.shareLinkToken)].enabled, true);
});

test("disabling sharing revokes the old link in the same Firestore commit", async () => {
  const token = "previous-share-token-123456789";
  const linkId = hash(token);
  const db = fakeDb({
    item: { shareEnabled: true, shareAudience: "circle", shareLinkId: linkId },
    oldLinks: { [linkId]: { ownerUid: "ownerA", targetKind: "book", targetId: "item-1", enabled: true, revokedAt: null } },
  });
  const result = await updateShareSettings({
    db, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: false, audience: "circle", recipientUids: [], linkEnabled: false },
    now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.shareEnabled, false);
  assert.equal(db.state.item.shareLinkId, null);
  assert.equal(db.state.shareLinks[linkId].enabled, false);
  assert.equal(db.state.shareLinks[linkId].revokedAt, "2026-11-10T00:00:00Z");
});

test("rejects stale versions, private shelves, unconnected recipients and invalid combinations", async () => {
  const db = fakeDb({ collection: "shelves", item: { is_private: true } });
  await assert.rejects(updateShareSettings({
    db, uid: "ownerA", collection: "shelves", id: "item-1", expectedUpdateTime: "old",
    input: { enabled: true, audience: "circle", recipientUids: [], linkEnabled: false },
  }), SharingConflictError);
  await assert.rejects(updateShareSettings({
    db, uid: "ownerA", collection: "shelves", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "circle", recipientUids: [], linkEnabled: false },
  }), SharingPermissionError);
  const disconnected = fakeDb();
  await assert.rejects(updateShareSettings({
    db: disconnected, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "selected", recipientUids: ["readerB"], linkEnabled: false },
  }), SharingPermissionError);
  await assert.rejects(updateShareSettings({
    db, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "selected", recipientUids: [], linkEnabled: true },
  }), SharingInputError);
});

test("revoked and unknown public share tokens return not found", async () => {
  const db = fakeDb();
  await assert.rejects(resolvePublicShare({ db, token: "unknown-share-token-123456789" }), SharingNotFoundError);
});


test("shared-with-me feed returns selected items only to verified recipients and excludes private notes", async () => {
  const ownerUid = "ownerB";
  const viewerUid = "readerA";
  const identity = { ownerB: "legacy-ownerB", readerA: "legacy-readerA" };
  const document = {
    id: "book-1",
    data: () => ({
      title: "Selected book", author: "Owner", shareEnabled: true,
      shareAudience: "selected", sharedWithUids: [viewerUid], notes: "secret",
    }),
    ref: { parent: { id: "books", parent: { id: ownerUid, parent: { id: "users" } } } },
  };
  const db = {
    collectionGroup(name) {
      return { where(field, operator, value) {
        return { limit: () => ({ get: async () => ({
          docs: name === "books" && ((field === "sharedWithUids" && operator === "array-contains" && value === viewerUid) ||
            (field === "shareEnabled" && operator === "==" && value === true)) ? [document] : [],
        }) }) };
      } };
    },
    collection(name) {
      if (name === "users") return { doc(uid) {
        return {
          get: async () => ({ exists: true, data: () => ({ displayName: uid }) }),
          collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
        };
      } };
      if (name === "identityLinks") return { doc(uid) { return { get: async () => ({
        exists: Boolean(identity[uid]), data: () => ({ status: "verified", base44UserId: identity[uid] }),
      }) }; } };
      if (name === "legacyIdentityLinks") return { doc(id) { return { get: async () => ({
        exists: Object.values(identity).includes(id),
        data: () => ({ status: "verified", firebaseUid: Object.keys(identity).find((uid) => identity[uid] === id) }),
      }) }; } };
      if (name === "relationships" || name === "blocks") return { doc() { return { get: async () => ({ exists: false }) }; } };
      throw new Error("Unexpected collection " + name);
    },
  };
  const result = await (await import("./firestoreSharing.js")).listSharedWithMe({ db, uid: viewerUid });
  assert.equal(result.count, 1);
  assert.equal(result.records[0].kind, "book");
  assert.equal(result.records[0].ownerName, ownerUid);
  assert.equal(result.records[0].ownerUid, ownerUid);
  assert.equal(result.records[0].item.title, "Selected book");
  assert.equal("notes" in result.records[0].item, false);
});


test("includes spice rating in shared projections only when the owner opted in", async () => {
  const db = fakeDb({ item: { spice_rating: 5, spice_shared: true } });
  const result = await updateShareSettings({
    db, uid: "ownerA", collection: "books", id: "item-1", expectedUpdateTime: "v1",
    input: { enabled: true, audience: "circle", recipientUids: [], linkEnabled: true },
    createToken: () => "spice-opt-in-share-token-123456",
  });
  const resolved = await resolvePublicShare({ db, token: result.shareLinkToken });
  assert.equal(resolved.item.spice_shared, true);
  assert.equal(resolved.item.spice_rating, 5);
});
