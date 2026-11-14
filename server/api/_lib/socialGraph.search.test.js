
import test from "node:test";
import assert from "node:assert/strict";
import { blockId, checkUsernameAvailability, relationshipId, searchReader } from "./socialGraph.js";

function createSearchDb({ profiles = {}, usernameReservations = {}, identityLinks = {}, legacyIdentityLinks = {}, blocks = {}, relationships = {}, shelves = {} } = {}) {
  const docs = (records) => Object.entries(records).map(([id, data]) => ({ id, data: () => structuredClone(data) }));
  return {
    collection(name) {
      if (name === "users") {
        return {
          where(field, operator, value) {
            assert.deepEqual([field, operator], ["nameSearchTokens", "array-contains"]);
            return { limit(max) { return { get: async () => ({
              docs: docs(profiles).filter((document) => {
                const profile = document.data();
                return Array.isArray(profile.nameSearchTokens) && profile.nameSearchTokens.includes(value);
              }).slice(0, max),
            }) }; } };
          },
          doc(uid) {
            return {
              get: async () => ({ exists: Boolean(profiles[uid]), data: () => structuredClone(profiles[uid] || {}) }),
              collection(subcollection) {
                assert.equal(subcollection, "shelves");
                return {
                  where(field, operator, value) {
                    assert.deepEqual([field, operator, value], ["shareEnabled", "==", true]);
                    return { limit(max) { return { get: async () => ({ docs: docs(shelves[uid] || {}).slice(0, max) }) }; } };
                  },
                };
              },
            };
          },
        };
      }
      const source = name === "identityLinks" ? identityLinks
        : name === "legacyIdentityLinks" ? legacyIdentityLinks
          : name === "usernameReservations" ? usernameReservations
            : name === "blocks" ? blocks : relationships;
      return {
        doc(id) {
          return { get: async () => ({ exists: Object.hasOwn(source, id), data: () => structuredClone(source[id] || {}) }) };
        },
      };
    },
  };
}

function verifiedProfiles(profiles, { blocks = {}, relationships = {}, shelves = {} } = {}) {
  const identityLinks = {};
  const legacyIdentityLinks = {};
  const usernameReservations = {};
  for (const [uid, profile] of Object.entries(profiles)) {
    identityLinks[uid] = { status: "verified", base44UserId: `legacy-${uid}` };
    legacyIdentityLinks[`legacy-${uid}`] = { status: "verified", firebaseUid: uid };
    const username = String(profile.username || "").trim().replace(/^@+/, "").toLowerCase();
    if (username && !usernameReservations[username]) usernameReservations[username] = { uid };
  }
  return createSearchDb({ profiles, usernameReservations, identityLinks, legacyIdentityLinks, blocks, relationships, shelves });
}

test("searches exact usernames and returns only the public reader projection", async () => {
  const relationship = relationshipId("readerA", "readerB");
  const db = verifiedProfiles({
    readerA: { displayName: "Reader A" },
    readerB: { displayName: "Reader B", username: "readerb", profileHidden: false },
  }, {
    relationships: { [relationship]: { followerUid: "readerA", followingUid: "readerB", status: "pending" } },
    shelves: { readerB: {
      circle: { shareEnabled: true, isPrivate: false, shareAudience: "circle" },
      selected: { shareEnabled: true, isPrivate: false, shareAudience: "selected" },
      private: { shareEnabled: true, isPrivate: true, shareAudience: "circle" },
    } },
  });
  const result = await searchReader({ db, viewerUid: "readerA", username: "readerb" });
  assert.deepEqual(result.readers, [{
    id: "readerB", name: "Reader B", username: "readerb", shared_shelves: 1, state: "pending",
  }]);
  assert.equal(JSON.stringify(result).includes("email"), false);
});

test("honours hidden, blocked and unlinked profiles and uses the unique username reservation", async () => {
  const profiles = {
    readerA: { displayName: "Reader A" },
    readerB: { displayName: "Reader B", username: "readerb", profileHidden: true },
    readerC: { displayName: "Reader C", username: "readerc", profileHidden: false },
    readerD: { displayName: "Reader D", username: "readerdup", profileHidden: false },
    readerE: { displayName: "Reader E", username: "readerdup", profileHidden: false },
  };
  const db = verifiedProfiles(profiles, { blocks: { [blockId("readerA", "readerC")]: { blockerUid: "readerA", blockedUid: "readerC" } } });
  assert.deepEqual((await searchReader({ db, viewerUid: "readerA", username: "readerb" })).readers, []);
  assert.deepEqual((await searchReader({ db, viewerUid: "readerA", username: "readerc" })).readers, []);
  assert.deepEqual((await searchReader({ db, viewerUid: "readerA", username: "readerdup" })).readers.map((reader) => reader.id), ["readerD"]);
  assert.deepEqual((await searchReader({ db, viewerUid: "readerA", username: "readera" })).readers, []);

  const unlinked = createSearchDb({
    profiles: { readerA: profiles.readerA, readerF: { username: "readerf", profileHidden: false } },
    usernameReservations: { readerf: { uid: "readerF" } },
  });
  assert.deepEqual((await searchReader({ db: unlinked, viewerUid: "readerA", username: "readerf" })).readers, []);
});

test("exact email lookup requires a verified Firebase account and never returns the email field", async () => {
  const db = verifiedProfiles({
    readerA: { displayName: "Reader A" },
    readerB: { displayName: "", username: "readerb", profileHidden: false },
  });
  const email = "known.reader@example.test";
  const result = await searchReader({
    db, viewerUid: "readerA", emailLookup: true, emailUser: { uid: "readerB", emailVerified: true }, emailFallback: email,
  });
  assert.deepEqual(result.readers, [{
    id: "readerB", name: email, username: "readerb", shared_shelves: 0, state: "none",
  }]);
  assert.equal(Object.hasOwn(result.readers[0], "email"), false);
  assert.deepEqual((await searchReader({
    db, viewerUid: "readerA", emailLookup: true, emailUser: { uid: "readerB", emailVerified: false }, emailFallback: email,
  })).readers, []);
  assert.deepEqual((await searchReader({ db, viewerUid: "readerA", emailLookup: true, emailUser: null, emailFallback: email })).readers, []);
});


test("full-name substring search uses normalized bigrams and filters hidden, blocked and unlinked readers", async () => {
  const profiles = {
    viewer: { displayName: "Reader A" },
    readerB: { displayName: "Alicia Smith", username: "alicia", profileHidden: false, nameSearchTokens: ["al", "li", "ic", "ci", "ia", "a ", " s", "sm", "mi", "it", "th"] },
    readerC: { displayName: "José Smith", username: "jose", profileHidden: false, nameSearchTokens: ["jo", "os", "se", "e ", " s", "sm", "mi", "it", "th"] },
    hidden: { displayName: "Hidden Smith", profileHidden: true, nameSearchTokens: ["sm"] },
    blocked: { displayName: "Blocked Smith", profileHidden: false, nameSearchTokens: ["sm"] },
    unlinked: { displayName: "Unlinked Smith", profileHidden: false, nameSearchTokens: ["sm"] },
  };
  const identityLinks = {};
  const legacyIdentityLinks = {};
  for (const uid of ["viewer", "readerB", "readerC", "hidden", "blocked"]) {
    identityLinks[uid] = { status: "verified", base44UserId: `legacy-${uid}` };
    legacyIdentityLinks[`legacy-${uid}`] = { status: "verified", firebaseUid: uid };
  }
  const db = createSearchDb({
    profiles,
    identityLinks,
    legacyIdentityLinks,
    blocks: { [blockId("viewer", "blocked")]: { blockerUid: "viewer", blockedUid: "blocked" } },
  });
  const result = await searchReader({ db, viewerUid: "viewer", nameQuery: "SMITH" });
  assert.deepEqual(result.readers.map((reader) => reader.id), ["readerB", "readerC"]);
  assert.equal(result.readers[1].name, "José Smith");
  assert.deepEqual((await searchReader({ db, viewerUid: "viewer", nameQuery: "jose" })).readers.map((reader) => reader.id), ["readerC"]);
  await assert.rejects(searchReader({ db, viewerUid: "viewer", nameQuery: "x" }), /2-40 characters/);
});

test("username availability is based on the unique reservation and allows the current owner", async () => {
  const db = verifiedProfiles({
    readerA: { displayName: "Reader A", username: "readera" },
    readerB: { displayName: "Reader B", username: "readerb" },
  });
  assert.deepEqual(await checkUsernameAvailability({ db, viewerUid: "readerA", username: "readerz" }), {
    username: "readerz", available: true,
  });
  assert.deepEqual(await checkUsernameAvailability({ db, viewerUid: "readerA", username: "readerb" }), {
    username: "readerb", available: false,
  });
  assert.deepEqual(await checkUsernameAvailability({ db, viewerUid: "readerA", username: "readera" }), {
    username: "readera", available: true,
  });
  await assert.rejects(
    checkUsernameAvailability({ db, viewerUid: "readerA", username: "bad.name" }),
    /3-20 letters, numbers or underscores/,
  );
});
