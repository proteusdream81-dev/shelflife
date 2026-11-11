
import test from "node:test";
import assert from "node:assert/strict";
import {
  createFirebaseRateLimiter,
  FirebaseRateLimitStoreError,
  RATE_LIMIT_WINDOW_MS,
} from "./rateLimit.js";

function createMemoryDb({ beforeWrite = async () => {} } = {}) {
  const documents = new Map();
  let version = 0;
  const db = {
    collection(name) {
      assert.equal(name, "rateLimits");
      return {
        doc(id) {
          return {
            async get() {
              await Promise.resolve();
              const record = documents.get(id);
              return {
                exists: Boolean(record),
                id,
                updateTime: record?.updateTime || null,
                data: () => record ? structuredClone(record.data) : null,
              };
            },
            async create(data) {
              await beforeWrite();
              if (documents.has(id)) throw Object.assign(new Error("already exists"), { code: "ALREADY_EXISTS" });
              version += 1;
              documents.set(id, { data: structuredClone(data), updateTime: `v${version}` });
            },
            async update(data, { lastUpdateTime } = {}) {
              await beforeWrite();
              const record = documents.get(id);
              if (!record || record.updateTime !== lastUpdateTime) {
                throw Object.assign(new Error("stale update"), { code: "FAILED_PRECONDITION" });
              }
              version += 1;
              documents.set(id, { data: structuredClone(data), updateTime: `v${version}` });
            },
          };
        },
      };
    },
  };
  return { db, documents };
}

test("enforces a per-reader sliding window and expires old attempts", async () => {
  const { db } = createMemoryDb();
  let clock = 1000;
  const limiter = createFirebaseRateLimiter({ getDb: async () => db, now: () => clock });
  const options = { uid: "reader-private-uid", bucket: "bookGroups", max: 2 };

  assert.equal(await limiter.consume(options), true);
  clock = 2000;
  assert.equal(await limiter.consume(options), true);
  clock = 3000;
  assert.equal(await limiter.consume(options), false);
  clock = RATE_LIMIT_WINDOW_MS + 2001;
  assert.equal(await limiter.consume(options), true);
});

test("stores only hashed actor identity and keeps one document per actor and bucket", async () => {
  const { db, documents } = createMemoryDb();
  const limiter = createFirebaseRateLimiter({ getDb: async () => db, now: () => 5000 });
  await limiter.consume({ uid: "reader-private-uid", bucket: "readingCircleWrite", max: 60 });
  const [[id, record]] = documents.entries();
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.match(record.data.actorHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record.data).includes("reader-private-uid"), false);
  assert.deepEqual(record.data.timestamps, [5000]);
});

test("serializes concurrent attempts with Firestore update-time compare-and-set", async () => {
  const { db, documents } = createMemoryDb();
  const limiter = createFirebaseRateLimiter({ getDb: async () => db, now: () => 9000, maxAttempts: 20 });
  const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consume({
    uid: "same-reader", bucket: "bookGroups", max: 3,
  })));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(results.filter((allowed) => !allowed).length, 17);
  const [record] = documents.values();
  assert.equal(record.data.timestamps.length, 3);
});

test("fails closed when the bounded compare-and-set retry budget is exhausted", async () => {
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => null }),
        create: async () => { throw Object.assign(new Error("contention"), { code: "ALREADY_EXISTS" }); },
      }),
    }),
  };
  const limiter = createFirebaseRateLimiter({ getDb: async () => db, now: () => 1000, maxAttempts: 2 });
  await assert.rejects(
    limiter.consume({ uid: "reader", bucket: "bookGroups", max: 30 }),
    FirebaseRateLimitStoreError,
  );
});

test("validates the actor, bucket, limit and time window", async () => {
  const { db } = createMemoryDb();
  const limiter = createFirebaseRateLimiter({ getDb: async () => db });
  await assert.rejects(limiter.consume({ uid: "bad/uid", bucket: "bookGroups", max: 30 }), TypeError);
  await assert.rejects(limiter.consume({ uid: "reader", bucket: "../users", max: 30 }), TypeError);
  await assert.rejects(limiter.consume({ uid: "reader", bucket: "bookGroups", max: 0 }), TypeError);
  await assert.rejects(limiter.consume({ uid: "reader", bucket: "bookGroups", max: 30, windowMs: 0 }), TypeError);
});