
import test from "node:test";
import assert from "node:assert/strict";
import { createSocialGraphHandler } from "./socialGraphHandler.js";
import { IdentityNotLinkedError } from "./profile.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;},
  };
}
const auth = async () => ({ ok: true, user: { uid: "readerA", emailVerified: true } });

test("follow route requires a verified migrated account and creates a pending request", async () => {
  const res = response();
  let created;
  const db = {
    collection(name) {
      return { doc(id) { return { async get() {
        if (name === "users") return { exists: true, data: () => ({ profileHidden: true }) };
        if (name === "identityLinks") return { exists: true, data: () => ({ status: "verified", base44UserId: "legacy-" + id }) };
        if (name === "legacyIdentityLinks") return { exists: true, data: () => ({ status: "verified", firebaseUid: id.replace("legacy-", "") }) };
        if (name === "blocks") return { exists: false, data: () => null };
        if (name === "relationships") return { exists: false, data: () => null };
        return { exists: false, data: () => null };
      }, async create(data) { created = data; } }; } };
    },
  };
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => db,
    resolveProfile: async () => ({}),
    consumeLimit: async () => true,
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.status, "pending");
  assert.equal(created.followerUid, "readerA");
});

test("block route rejects self-blocking and maps permission errors safely", async () => {
  const res = response();
  await createSocialGraphHandler({
    operation: "block",
    verifyToken: auth,
    getDb: async () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) }) }),
    resolveProfile: async () => ({}),
    consumeLimit: async () => true,
  })({ method: "POST", body: { blockedUid: "readerA" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /different valid reader/);
});

test("rejects unverified Firebase email before opening Firestore", async () => {
  const res = response();
  let dbCalls = 0;
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: async () => ({ ok: true, user: { uid: "readerA", emailVerified: false } }),
    getDb: async () => { dbCalls += 1; return {}; },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(dbCalls, 0);
});

test("does not expose social graph operations before profile migration", async () => {
  const res = response();
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => { throw new IdentityNotLinkedError(); },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 409);
});


test("relationship list route returns only the caller's following projection", async () => {
  const res = response();
  let query;
  const db = { collection(name) {
    return {
      doc(id) { return { get: async () => ({ exists: true, data: () => ({ displayName: "Reader " + id }) }) }; },
      where(field, operator, uid) {
        if (name === "blocks") return { limit() { return { get: async () => ({ docs: [] }) }; } };
        query = { name, field, operator, uid };
        return { limit() { return { async get() {
          return { docs: [{ id: "a".repeat(64), data: () => ({
            followerUid: uid, followingUid: "readerB", status: "accepted", createdAt: "2026-11-10T00:00:00Z",
            email: "private@example.test",
          }) }] };
        } }; } };
      },
    };
  } };
  await createSocialGraphHandler({
    operation: "list",
    verifyToken: auth,
    getDb: async () => db,
    resolveProfile: async () => ({}),
    consumeLimit: async () => true,
  })({ method: "GET", query: { direction: "following", limit: "25" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(query.name, "relationships");
  assert.equal(query.field, "followerUid");
  assert.deepEqual(res.body.records, [{
    id: "a".repeat(64), readerUid: "readerB", displayName: "Reader readerB", status: "accepted",
    createdAt: "2026-11-10T00:00:00Z", updatedAt: null,
  }]);
  assert.equal(JSON.stringify(res.body).includes("private@example.test"), false);
});


test("rate-limits social graph mutations before invoking the operation", async () => {
  const res = response();
  let consumed;
  let dbOpened = false;
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => { dbOpened = true; return {}; },
    resolveProfile: async () => ({}),
    consumeLimit: async (options) => { consumed = options; return false; },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(consumed, { uid: "readerA", bucket: "readingCircleWrite", max: 60 });
  assert.equal(dbOpened, true);
});

test("fails closed when the social graph rate-limit store is unavailable", async () => {
  const res = response();
  await createSocialGraphHandler({
    operation: "follow",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async () => { throw new Error("rate-limit storage unavailable"); },
  })({ method: "POST", body: { followingUid: "readerB" } }, res);
  assert.equal(res.statusCode, 503);
});

test("exact username search is rate-limited and delegates to the privacy-safe search projection", async () => {
  const res = response();
  let consumed;
  let searched;
  await createSocialGraphHandler({
    operation: "search",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async (options) => { consumed = options; return true; },
    searchReaders: async (options) => { searched = options; return { readers: [{ id: "readerB" }] }; },
  })({ method: "GET", query: { username: "@ReaderB" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(consumed, { uid: "readerA", bucket: "readingCircleNameSearch", max: 60 });
  assert.deepEqual(searched, {
    db: {}, viewerUid: "readerA", username: "readerb", emailLookup: false, emailUser: null, emailFallback: "",
  });
  assert.deepEqual(res.body, { readers: [{ id: "readerB" }] });
});

test("exact email search uses the tighter lookup cap and never echoes a missing account", async () => {
  const res = response();
  let consumed;
  let lookedUp;
  let searched;
  await createSocialGraphHandler({
    operation: "search",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async (options) => { consumed = options; return true; },
    findUserByEmail: async (email) => { lookedUp = email; return null; },
    searchReaders: async (options) => { searched = options; return { readers: [] }; },
  })({ method: "GET", query: { email: "READER@example.test" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(consumed, { uid: "readerA", bucket: "readingCircleEmailLookup", max: 15 });
  assert.equal(lookedUp, "reader@example.test");
  assert.equal(searched.emailLookup, true);
  assert.equal(searched.emailUser, null);
  assert.equal(JSON.stringify(res.body).includes("reader@example.test"), false);
});

test("search rejects malformed or ambiguous identifiers before opening Firestore", async () => {
  for (const query of [{}, { username: "a" }, { email: "not-an-email" }, { email: "a@example.test", username: "readerb" }]) {
    const res = response();
    let dbCalls = 0;
    await createSocialGraphHandler({
      operation: "search", verifyToken: auth,
      getDb: async () => { dbCalls += 1; return {}; },
      resolveProfile: async () => ({}),
    })({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(dbCalls, 0);
  }
});

test("search returns 429 before invoking Firebase Auth or profile lookup when capped", async () => {
  const res = response();
  let lookupCalls = 0;
  await createSocialGraphHandler({
    operation: "search", verifyToken: auth,
    getDb: async () => ({}), resolveProfile: async () => ({}),
    consumeLimit: async () => false,
    findUserByEmail: async () => { lookupCalls += 1; return null; },
  })({ method: "GET", query: { email: "reader@example.test" } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(lookupCalls, 0);
});


test("relationship list is capped at 150 reads per hour before querying Firestore", async () => {
  const res = response();
  let consumed;
  let relationshipQueryOpened = false;
  const db = { collection(name) {
    if (name === "relationships") relationshipQueryOpened = true;
    return { where() { throw new Error("relationship query should not run after the cap"); } };
  } };
  await createSocialGraphHandler({
    operation: "list",
    verifyToken: auth,
    getDb: async () => db,
    resolveProfile: async () => ({}),
    consumeLimit: async (options) => { consumed = options; return false; },
  })({ method: "GET", query: { direction: "following", limit: "25" } }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(consumed, { uid: "readerA", bucket: "readingCircleRead", max: 150 });
  assert.equal(relationshipQueryOpened, false);
});


test("username availability check is authenticated, normalized and rate-limited", async () => {
  const res = response();
  let consumed;
  let checked;
  await createSocialGraphHandler({
    operation: "search",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async (options) => { consumed = options; return true; },
    checkUsername: async (options) => { checked = options; return { username: options.username, available: true }; },
  })({ method: "GET", query: { checkUsername: "@Reader_Name" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(consumed, { uid: "readerA", bucket: "readingCircleWrite", max: 60 });
  assert.deepEqual(checked, { db: {}, viewerUid: "readerA", username: "reader_name" });
  assert.deepEqual(res.body, { username: "reader_name", available: true });
});

test("username availability check fails closed at the existing Reading Circle write cap", async () => {
  const res = response();
  let checked = false;
  await createSocialGraphHandler({
    operation: "search",
    verifyToken: auth,
    getDb: async () => ({}),
    resolveProfile: async () => ({}),
    consumeLimit: async () => false,
    checkUsername: async () => { checked = true; return { available: true }; },
  })({ method: "GET", query: { checkUsername: "reader_name" } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(checked, false);
});

test("search rejects invalid usernames and ambiguous availability modes before opening Firestore", async () => {
  for (const query of [
    { username: "a" },
    { username: "reader.name" },
    { checkUsername: "reader.name" },
    { email: "a@example.test", checkUsername: "reader_name" },
    { username: "readerb", checkUsername: "reader_name" },
  ]) {
    const res = response();
    let dbCalls = 0;
    await createSocialGraphHandler({
      operation: "search",
      verifyToken: auth,
      getDb: async () => { dbCalls += 1; return {}; },
      resolveProfile: async () => ({}),
    })({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(dbCalls, 0);
  }
});
