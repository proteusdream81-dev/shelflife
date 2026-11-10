import { randomUUID } from "node:crypto";

const COLLECTION_RULES = Object.freeze({
  books: Object.freeze({
    requiredOnCreate: ["title"],
    fields: Object.freeze({
      title: "string", author: "string", isbn: "string", asin: "string",
      cover_url: "url", alt_covers: "stringArray", description: "string",
      publisher: "string", published_date: "string", page_count: "positiveInteger",
      categories: "stringArray", buy_links: "json", google_books_id: "string",
      hardcover_id: "string", edited_fields: "stringArray", shelfIds: "shelfIds",
      status: "string", notes: "string", review: "string", rating: "rating",
      format: "string", formats: "stringArray", series_name: "string",
      series_position: "string", romance_subgenre: "string", spice: "json",
      spice_rating: "rating", spice_shared: "string", content_warnings: "stringArray",
    }),
  }),
  shelves: Object.freeze({
    requiredOnCreate: ["name"],
    fields: Object.freeze({
      name: "string", description: "string", is_private: "boolean",
    }),
  }),
});

const MAX_DOCUMENT_BYTES = 30000;
const MAX_TEXT_LENGTH = 8000;
const MAX_ARRAY_LENGTH = 50;

export class InvalidLibraryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidLibraryInputError";
  }
}

export class LibraryRecordNotFoundError extends Error {
  constructor() {
    super("Library record not found");
    this.name = "LibraryRecordNotFoundError";
  }
}

export class LibraryWriteConflictError extends Error {
  constructor(message = "Library record changed; reload and try again") {
    super(message);
    this.name = "LibraryWriteConflictError";
  }
}

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

function validDocumentId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateJsonValue(value, depth = 0) {
  if (depth > 8) throw new InvalidLibraryInputError("Nested data is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new InvalidLibraryInputError("Too many list items");
    value.forEach((item) => validateJsonValue(item, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new InvalidLibraryInputError("Unsupported object field");
      }
      validateJsonValue(item, depth + 1);
    }
    return;
  }
  throw new InvalidLibraryInputError("Unsupported data value");
}

function validateField(field, value, rule) {
  if (value === undefined) return;
  switch (rule) {
    case "string":
      if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
        throw new InvalidLibraryInputError(`${field} must be text no longer than ${MAX_TEXT_LENGTH} characters`);
      }
      break;
    case "url":
      if (typeof value !== "string" || value.length > 2048 ||
          (value && !/^https:\/\//i.test(value))) {
        throw new InvalidLibraryInputError(`${field} must be an HTTPS URL`);
      }
      break;
    case "positiveInteger":
      if (!Number.isSafeInteger(value) || value < 0 || value > 100000) {
        throw new InvalidLibraryInputError(`${field} must be a valid page count`);
      }
      break;
    case "rating":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) {
        throw new InvalidLibraryInputError(`${field} must be between 0 and 5`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new InvalidLibraryInputError(`${field} must be true or false`);
      break;
    case "stringArray":
      if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH ||
          value.some((item) => typeof item !== "string" || item.length > 500)) {
        throw new InvalidLibraryInputError(`${field} must be a list of at most ${MAX_ARRAY_LENGTH} text values`);
      }
      break;
    case "shelfIds":
      if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH ||
          value.some((item) => !validDocumentId(item))) {
        throw new InvalidLibraryInputError("shelfIds must contain valid shelf IDs");
      }
      if (new Set(value).size !== value.length) {
        throw new InvalidLibraryInputError("shelfIds cannot contain duplicates");
      }
      break;
    case "json":
      validateJsonValue(value);
      break;
    default:
      throw new InvalidLibraryInputError(`Unsupported field: ${field}`);
  }
}

function sanitizeInput(collection, input, { create = false } = {}) {
  const config = COLLECTION_RULES[collection];
  if (!config) throw new InvalidLibraryInputError("Unsupported library collection");
  if (!isPlainObject(input)) throw new InvalidLibraryInputError("A JSON object is required");
  const keys = Object.keys(input);
  if (keys.length === 0) throw new InvalidLibraryInputError("At least one field is required");
  const output = {};
  for (const [field, value] of Object.entries(input)) {
    const rule = config.fields[field];
    if (!rule) throw new InvalidLibraryInputError(`Field is not writable: ${field}`);
    validateField(field, value, rule);
    output[field] = value;
  }
  if (create) {
    for (const field of config.requiredOnCreate) {
      if (typeof output[field] !== "string" || !output[field].trim()) {
        throw new InvalidLibraryInputError(`${field} is required`);
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_DOCUMENT_BYTES) {
    throw new InvalidLibraryInputError("Library record is too large");
  }
  return output;
}

async function assertOwnedShelves({ db, uid, shelfIds }) {
  for (const shelfId of shelfIds || []) {
    const shelf = await db.collection("users").doc(uid).collection("shelves").doc(shelfId).get();
    if (!shelf.exists) {
      throw new InvalidLibraryInputError("Every selected shelf must belong to this account");
    }
  }
}

function collectionRef(db, uid, collection) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validUid(uid)) throw new TypeError("A valid Firebase UID is required");
  if (!Object.hasOwn(COLLECTION_RULES, collection)) throw new InvalidLibraryInputError("Unsupported library collection");
  return db.collection("users").doc(uid).collection(collection);
}

function projectRecord(collection, source, id) {
  const output = { id };
  for (const field of Object.keys(COLLECTION_RULES[collection].fields)) {
    if (Object.hasOwn(source || {}, field)) output[field] = source[field];
  }
  for (const field of ["createdAt", "updatedAt", "schemaVersion"]) {
    if (Object.hasOwn(source || {}, field)) output[field] = source[field];
  }
  if (collection === "books" && typeof source?.cover_storage_key === "string" && source.cover_storage_key) {
    output.cover_storage_key = source.cover_storage_key;
  }
  if (typeof source?.updateTime === "string") output.version = source.updateTime;
  return output;
}

export async function createUserLibraryRecord({ db, uid, collection, data, createId = randomUUID, now = () => new Date().toISOString() }) {
  const ref = collectionRef(db, uid, collection);
  const payload = sanitizeInput(collection, data, { create: true });
  if (collection === "books") await assertOwnedShelves({ db, uid, shelfIds: payload.shelfIds || [] });
  const timestamp = now();
  const record = {
    ...payload,
    ...(collection === "books" && !Object.hasOwn(payload, "status") ? { status: "to_read" } : {}),
    ...(collection === "books" && !Object.hasOwn(payload, "shelfIds") ? { shelfIds: [] } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
  };
  const id = createId();
  if (!validDocumentId(id)) throw new TypeError("Generated library record ID is invalid");
  let created;
  try {
    created = await ref.doc(id).create(record);
  } catch (error) {
    if (error?.code === "ALREADY_EXISTS" || error?.code === 409) {
      throw new LibraryWriteConflictError("A record with that ID already exists");
    }
    throw error;
  }
  return projectRecord(collection, { ...record, updateTime: created?.updateTime }, id);
}

export async function updateUserLibraryRecord({ db, uid, collection, id, data, expectedUpdateTime, now = () => new Date().toISOString() }) {
  const ref = collectionRef(db, uid, collection);
  if (!validDocumentId(id)) throw new InvalidLibraryInputError("A valid record ID is required");
  const patch = sanitizeInput(collection, data);
  if (collection === "books" && Object.hasOwn(patch, "shelfIds")) {
    await assertOwnedShelves({ db, uid, shelfIds: patch.shelfIds });
  }
  const document = ref.doc(id);
  const existing = await document.get();
  if (!existing.exists) throw new LibraryRecordNotFoundError();
  if (!existing.updateTime || typeof expectedUpdateTime !== "string" || !Number.isFinite(Date.parse(expectedUpdateTime))) {
    throw new LibraryWriteConflictError("Reload the record before editing");
  }
  if (expectedUpdateTime !== existing.updateTime) throw new LibraryWriteConflictError();
  const updated = { ...patch, updatedAt: now() };
  let updatedSnapshot;
  try {
    updatedSnapshot = await document.update(updated, { lastUpdateTime: existing.updateTime });
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new LibraryWriteConflictError();
    }
    throw error;
  }
  return projectRecord(collection, { ...existing.data(), ...updated, updateTime: updatedSnapshot?.updateTime }, id);
}


/**
 * Persist an R2 object key only through this dedicated path. Generic book
 * create/update requests deliberately cannot write cover_storage_key.
 */
export async function updateUserBookCover({
  db,
  uid,
  id,
  objectKey,
  expectedUpdateTime,
  now = () => new Date().toISOString(),
}) {
  const ref = collectionRef(db, uid, "books");
  if (!validDocumentId(id)) throw new InvalidLibraryInputError("A valid book ID is required");
  const prefix = `${uid}/`;
  const filename = typeof objectKey === "string" && objectKey.startsWith(prefix)
    ? objectKey.slice(prefix.length)
    : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
  if (!filename || objectKey.length > 180 || !uuidPattern.test(filename)) {
    throw new InvalidLibraryInputError("Cover object key is invalid or does not belong to this account");
  }

  const document = ref.doc(id);
  const existing = await document.get();
  if (!existing.exists) throw new LibraryRecordNotFoundError();
  if (!existing.updateTime || typeof expectedUpdateTime !== "string" ||
      !Number.isFinite(Date.parse(expectedUpdateTime))) {
    throw new LibraryWriteConflictError("Reload the book before changing its cover");
  }
  if (expectedUpdateTime !== existing.updateTime) throw new LibraryWriteConflictError();

  const patch = { cover_storage_key: objectKey, updatedAt: now() };
  let updatedSnapshot;
  try {
    updatedSnapshot = await document.update(patch, { lastUpdateTime: existing.updateTime });
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new LibraryWriteConflictError();
    }
    throw error;
  }
  return projectRecord("books", {
    ...(existing.data() || {}),
    ...patch,
    updateTime: updatedSnapshot?.updateTime,
  }, id);
}
