const BOOK_FIELDS = Object.freeze([
  "title", "author", "isbn", "asin", "cover_url", "alt_covers", "description",
  "publisher", "published_date", "page_count", "categories", "buy_links",
  "google_books_id", "hardcover_id", "community_rating", "community_ratings_count",
  "enrichment_status", "edited_fields", "shelfIds", "status", "notes",
  "review", "rating", "format", "formats", "series_name", "series_position",
  "romance_subgenre", "spice", "spice_rating", "spice_shared", "content_warnings",
    "createdAt", "updatedAt", "schemaVersion",
]);

const SHELF_FIELDS = Object.freeze([
  "name", "description", "is_private", "createdAt", "updatedAt", "schemaVersion",
]);

export const USER_LIBRARY_COLLECTIONS = Object.freeze({
  books: BOOK_FIELDS,
  shelves: SHELF_FIELDS,
});

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

function validCursor(cursor) {
  return typeof cursor === "string" &&
    cursor.length > 0 &&
    cursor.length <= 1500 &&
    cursor !== "." &&
    cursor !== ".." &&
    !cursor.includes("/");
}

export function validateLibraryLimit(limit) {
  return Number.isInteger(limit) && limit >= 1 && limit <= 100;
}

export async function listUserLibraryCollection({ db, uid, collection, limit = 50, cursor = null }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validUid(uid)) throw new TypeError("A valid Firebase UID is required");
  const fields = USER_LIBRARY_COLLECTIONS[collection];
  if (!fields) throw new TypeError("Unsupported user library collection");
  if (!validateLibraryLimit(limit)) throw new TypeError("Limit must be an integer from 1 to 100");
  if (cursor !== null && !validCursor(cursor)) throw new TypeError("Invalid pagination cursor");

  const collectionRef = db.collection("users").doc(uid).collection(collection);
  const snapshot = cursor === null
    ? await collectionRef.limit(limit).get()
    : await collectionRef.limit(limit).startAfter(cursor).get();

  const records = (snapshot.docs || []).map((document) => {
    const source = document.data() || {};
    const record = {};
    for (const field of fields) {
      if (Object.hasOwn(source, field)) record[field] = source[field];
    }
    // Firestore document path is authoritative; never trust an embedded legacy "id".
    return {
      ...record,
      id: document.id,
      ...(typeof document.updateTime === "string" ? { version: document.updateTime } : {}),
    };
  });

  return {
    collection,
    count: records.length,
    records,
    nextCursor: records.length === limit ? records[records.length - 1].id : null,
  };
}

export { BOOK_FIELDS, SHELF_FIELDS };
