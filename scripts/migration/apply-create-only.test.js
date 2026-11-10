import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMigrationPlanCreateOnly,
  MigrationApplyDisabledError,
  MigrationDocumentConflictError,
} from "./apply-create-only.js";

function fakeDb(initial = {}, projectId = "shelflife-staging-123") {
  const state = structuredClone(initial);
  const refFor = (path) => ({
    async get() {
      const value = state[path];
      return { exists: value !== undefined, data: () => value === undefined ? null : structuredClone(value) };
    },
    async create(data) {
      if (state[path] !== undefined) {
        const error = new Error("already exists");
        error.code = "ALREADY_EXISTS";
        throw error;
      }
      state[path] = structuredClone(data);
      return { updateTime: "created" };
    },
  });
  const collectionFor = (prefix) => ({
    doc(id) {
      const path = prefix ? `${prefix}/${id}` : id;
      return {
        ...refFor(path),
        collection(name) { return collectionFor(`${path}/${name}`); },
      };
    },
  });
  return { projectId, state, collection: (name) => collectionFor(name) };
}

const plan = {
  snapshotId: "snapshot-2026-11-10",
  schemaVersion: 1,
  applyMode: "disabled",
  documents: [
    { entity: "User", sourceId: "legacy-a", path: "users/firebase-a", data: { displayName: "Reader A", schemaVersion: 1 } },
    { entity: "Book", sourceId: "book-1", path: "users/firebase-a/books/book-1", data: { title: "Example", shelfIds: [], schemaVersion: 1 } },
  ],
};

const options = {
  plan,
  allowWrites: true,
  environment: "non-production",
  targetProjectId: "shelflife-staging-123",
};

test("is disabled unless an explicit non-production write opt-in is supplied", async () => {
  const db = fakeDb();
  await assert.rejects(applyMigrationPlanCreateOnly({ db, plan }), MigrationApplyDisabledError);
  await assert.rejects(applyMigrationPlanCreateOnly({ db, ...options, environment: "production" }), MigrationApplyDisabledError);
  await assert.rejects(applyMigrationPlanCreateOnly({ db, ...options, targetProjectId: "shelflife-tbr-9754d" }), MigrationApplyDisabledError);
  await assert.rejects(applyMigrationPlanCreateOnly({ db: fakeDb({}, "shelflife-tbr-9754d"), ...options }), MigrationApplyDisabledError);
  await assert.rejects(applyMigrationPlanCreateOnly({ db: fakeDb({}, "another-project"), ...options }), MigrationApplyDisabledError);
  assert.deepEqual(db.state, {});
});

test("creates documents once and skips exact matches on retry", async () => {
  const db = fakeDb();
  const first = await applyMigrationPlanCreateOnly({ db, ...options });
  assert.equal(first.created, 2);
  assert.equal(first.alreadyPresent, 0);
  assert.equal(first.writesPerformed, 2);
  const second = await applyMigrationPlanCreateOnly({ db, ...options });
  assert.equal(second.created, 0);
  assert.equal(second.alreadyPresent, 2);
  assert.equal(second.writesPerformed, 0);
});

test("fails closed on an existing target document with different content", async () => {
  const db = fakeDb({ "users/firebase-a": { displayName: "Different reader" } });
  await assert.rejects(
    applyMigrationPlanCreateOnly({ db, ...options }),
    (error) => error instanceof MigrationDocumentConflictError && error.path === "users/firebase-a",
  );
  assert.equal(db.state["users/firebase-a"].displayName, "Different reader");
  assert.equal(db.state["users/firebase-a/books/book-1"], undefined);
});

test("rejects duplicate paths, malformed paths and oversized batches", async () => {
  const db = fakeDb();
  await assert.rejects(applyMigrationPlanCreateOnly({
    db, ...options, plan: { ...plan, documents: [...plan.documents, plan.documents[0]] },
  }), /duplicate target paths/);
  await assert.rejects(applyMigrationPlanCreateOnly({
    db, ...options, plan: { ...plan, documents: [{ ...plan.documents[0], path: "users//bad" }] },
  }), /invalid document/);
  await assert.rejects(applyMigrationPlanCreateOnly({
    db, ...options, maxDocuments: 1,
  }), MigrationApplyDisabledError);
  assert.deepEqual(db.state, {});
});

test("does not overwrite a document created by a concurrent importer with different data", async () => {
  const db = fakeDb();
  const originalCollection = db.collection;
  db.collection = (name) => {
    const collection = originalCollection(name);
    const originalDoc = collection.doc;
    collection.doc = (id) => {
      const ref = originalDoc(id);
      if (name === "users" && id === "firebase-a") {
        const originalCreate = ref.create;
        ref.create = async (data) => {
          db.state["users/firebase-a"] = { displayName: "Concurrent writer" };
          return originalCreate(data);
        };
      }
      return ref;
    };
    return collection;
  };
  await assert.rejects(
    applyMigrationPlanCreateOnly({ db, ...options }),
    MigrationDocumentConflictError,
  );
  assert.equal(db.state["users/firebase-a"].displayName, "Concurrent writer");
});


test("preflights all existing documents before writing any new document", async () => {
  const db = fakeDb({ "users/firebase-a/books/book-1": { title: "Conflicting target" } });
  await assert.rejects(
    applyMigrationPlanCreateOnly({ db, ...options }),
    (error) => error instanceof MigrationDocumentConflictError && error.path === "users/firebase-a/books/book-1",
  );
  assert.equal(db.state["users/firebase-a"], undefined);
  assert.equal(db.state["users/firebase-a/books/book-1"].title, "Conflicting target");
});
