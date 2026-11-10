import { isDeepStrictEqual } from "node:util";

export class MigrationApplyDisabledError extends Error {
  constructor(message = "Migration writes are disabled") {
    super(message);
    this.name = "MigrationApplyDisabledError";
  }
}
export class MigrationDocumentConflictError extends Error {
  constructor(path) {
    super("A target document already exists with different content");
    this.name = "MigrationDocumentConflictError";
    this.path = path;
  }
}

function validPath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.endsWith("/") || path.includes("//")) return false;
  const segments = path.split("/");
  return segments.length >= 2 && segments.length % 2 === 0 &&
    segments.every((segment) => segment && segment !== "." && segment !== ".." && !/[\u0000-\u001f\u007f]/.test(segment));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function documentReference(db, path) {
  const segments = path.split("/");
  let collection = db.collection(segments[0]);
  let ref;
  for (let index = 1; index < segments.length; index += 2) {
    ref = collection.doc(segments[index]);
    if (index + 1 < segments.length) collection = ref.collection(segments[index + 1]);
  }
  return ref;
}

/**
 * Resumable create-only importer. It never updates or deletes target documents.
 * A rerun skips exact matches and stops on any conflicting pre-existing document.
 * This function is not called by the dry-run CLI or any deployed API route.
 */
export async function applyMigrationPlanCreateOnly({
  db,
  plan,
  allowWrites = false,
  environment = "production",
  targetProjectId = null,
  sourceProjectId = "shelflife-tbr-9754d",
  maxDocuments = 500,
}) {
  if (allowWrites !== true) throw new MigrationApplyDisabledError();
  if (environment !== "non-production") {
    throw new MigrationApplyDisabledError("Migration writes are permitted only in an explicitly designated non-production environment");
  }
  if (typeof targetProjectId !== "string" || !targetProjectId ||
      targetProjectId === sourceProjectId || targetProjectId === "shelflife-tbr-9754d" ||
      db?.projectId !== targetProjectId) {
    throw new MigrationApplyDisabledError("The actual Firestore client must be bound to the declared separate non-production Firebase project");
  }
  if (!db || typeof db.collection !== "function" || !Array.isArray(plan?.documents)) {
    throw new TypeError("A Firestore database and migration plan are required");
  }
  if (plan.schemaVersion !== 1 || plan.applyMode !== "disabled") {
    throw new TypeError("Unsupported or already-enabled migration plan");
  }
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 500) {
    throw new TypeError("maxDocuments must be between 1 and 500");
  }

  const seen = new Set();
  const documents = plan.documents;
  if (documents.length > maxDocuments) {
    throw new MigrationApplyDisabledError("Plan exceeds the bounded batch size; split it into independently reviewed batches");
  }
  let created = 0;
  let alreadyPresent = 0;
  for (const item of documents) {
    if (!validPath(item?.path) || !item.data || typeof item.data !== "object" ||
        Array.isArray(item.data) || Object.getPrototypeOf(item.data) !== Object.prototype) {
      throw new TypeError("Migration plan contains an invalid document");
    }
    if (seen.has(item.path)) throw new TypeError("Migration plan contains duplicate target paths");
    seen.add(item.path);
    const ref = documentReference(db, item.path);
    const existing = await ref.get();
    if (existing.exists) {
      if (!isDeepStrictEqual(canonical(existing.data() || {}), canonical(item.data))) {
        throw new MigrationDocumentConflictError(item.path);
      }
      alreadyPresent += 1;
      continue;
    }
    try {
      await ref.create(item.data);
      created += 1;
    } catch (error) {
      if (error?.code !== "ALREADY_EXISTS" && error?.code !== 409) throw error;
      const raced = await ref.get();
      if (!raced.exists || !isDeepStrictEqual(canonical(raced.data() || {}), canonical(item.data))) {
        throw new MigrationDocumentConflictError(item.path);
      }
      alreadyPresent += 1;
    }
  }
  return {
    snapshotId: plan.snapshotId,
    targetProjectId,
    attempted: documents.length,
    created,
    alreadyPresent,
    writesPerformed: created,
    mode: "create-only-idempotent",
  };
}
