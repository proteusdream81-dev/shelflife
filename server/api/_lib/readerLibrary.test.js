import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { listSharedReaderLibrary, SharingNotFoundError, SharingConflictError } from "./firestoreSharing.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const relationshipId = (first, second) => hash(`${first}\0${second}`);
const blockId = relationshipId;

function makeDb({ connected = true, blocked = false, hideCovers = true, manyBooks = false } = {}) {
  const identities = { readerA: "legacy-readerA", readerB: "legacy-readerB" };
  const directBook = {
    id: "direct-book",
    data: () => ({ title: "Direct book", author: "Owner", shareEnabled: true,
      shareAudience: "selected", sharedWithUids: ["readerA"], cover_url: "https://img.test/direct.jpg",
      alt_covers: ["https://img.test/direct-alt.jpg"], notes: "private note", review: "private review" }),
  };
  const shelfBook = {
    id: "shelf-book",
    data: () => ({ title: "Shelf book", author: "Owner", shelfIds: ["shelf-1"],
      cover_url: "https://img.test/shelf.jpg", alt_covers: ["https://img.test/shelf-alt.jpg"], notes: "private shelf note" }),
  };
  const shelves = [
    { id: "shelf-1", data: () => ({ name: "Shared shelf", description: "Visible", createdAt: "2026-01-01",
      shareEnabled: true, shareAudience: "circle", is_private: false }) },
    { id: "private-shelf", data: () => ({ name: "Private", shareEnabled: true,
      shareAudience: "circle", is_private: true }) },
  ];
  const docsFor = (uid, name, field, value) => {
    if (uid !== "readerB") return [];
    if (name === "books" && field === "shareEnabled") return manyBooks
      ? Array.from({ length: 101 }, (_, index) => ({ id: `book-${index}`, data: () => ({ shareEnabled: true, shareAudience: "selected", sharedWithUids: ["readerA"] }) }))
      : [directBook];
    if (name === "shelves" && field === "shareEnabled") return shelves;
    if (name === "books" && field === "shelfIds" && value === "shelf-1") return [shelfBook];
    return [];
  };
  return {
    collection(name) {
      if (name === "users") return { doc(uid) {
        return {
          get: async () => ({ exists: identities[uid] !== undefined, data: () => ({
            displayName: uid === "readerB" ? "Shared Reader" : "Viewer", hideCovers: uid === "readerB" && hideCovers,
          }) }),
          collection(collectionName) {
            return {
              where(field, operator, value) {
                return { limit(maximum) { return { get: async () => ({ docs: docsFor(uid, collectionName, field, value).slice(0, maximum) }) }; } };
              },
            };
          },
        };
      } };
      if (name === "identityLinks") return { doc(uid) { return { get: async () => ({
        exists: Boolean(identities[uid]), data: () => ({ status: "verified", base44UserId: identities[uid] }),
      }) }; } };
      if (name === "legacyIdentityLinks") return { doc(id) { return { get: async () => ({
        exists: Object.values(identities).includes(id),
        data: () => ({ status: "verified", firebaseUid: Object.keys(identities).find((uid) => identities[uid] === id) }),
      }) }; } };
      if (name === "relationships" || name === "blocks") return { doc(id) { return { get: async () => ({
        exists: name === "blocks" ? blocked : connected && id === relationshipId("readerB", "readerA"),
        data: () => name === "blocks" ? { blockerUid: "readerB", blockedUid: "readerA" }
          : { followerUid: "readerB", followingUid: "readerA", status: "accepted" },
      }) }; } };
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}

test("returns only items shared with the viewer and strips owner-private fields and hidden covers", async () => {
  const result = await listSharedReaderLibrary({ db: makeDb(), viewerUid: "readerA", readerUid: "readerB" });
  assert.equal(result.ownerName, "Shared Reader");
  assert.equal(result.covers_hidden, true);
  assert.equal(result.shelves.length, 1);
  assert.equal(result.shelves[0].name, "Shared shelf");
  assert.equal(result.shelves[0].books[0].id, "shelf-book");
  assert.equal(result.shelves[0].books[0].cover_url, "");
  assert.deepEqual(result.shelves[0].books[0].alt_covers, []);
  assert.equal("notes" in result.shelves[0].books[0], false);
  assert.equal(result.shared_books.length, 1);
  assert.equal(result.shared_books[0].id, "direct-book");
  assert.equal(result.shared_books[0].cover_url, "");
  assert.deepEqual(result.shared_books[0].alt_covers, []);
  assert.equal("notes" in result.shared_books[0], false);
  assert.equal("review" in result.shared_books[0], false);
});

test("selected-recipient shares remain visible without a circle connection", async () => {
  const result = await listSharedReaderLibrary({ db: makeDb({ connected: false, hideCovers: false }), viewerUid: "readerA", readerUid: "readerB" });
  assert.equal(result.shelves.length, 0);
  assert.deepEqual(result.shared_books.map((book) => book.id), ["direct-book"]);
  assert.equal(result.shared_books[0].cover_url, "https://img.test/direct.jpg");
});

test("blocks take precedence over selected and circle shares", async () => {
  await assert.rejects(
    listSharedReaderLibrary({ db: makeDb({ blocked: true }), viewerUid: "readerA", readerUid: "readerB" }),
    SharingNotFoundError,
  );
});

test("rejects self-browsing and bounds oversized reader libraries", async () => {
  await assert.rejects(
    listSharedReaderLibrary({ db: makeDb(), viewerUid: "readerA", readerUid: "readerA" }),
    /different valid reader account/,
  );
  await assert.rejects(
    listSharedReaderLibrary({ db: makeDb({ manyBooks: true }), viewerUid: "readerA", readerUid: "readerB" }),
    SharingConflictError,
  );
});
