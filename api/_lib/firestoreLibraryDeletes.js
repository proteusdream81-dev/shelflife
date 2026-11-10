import {
  LibraryRecordNotFoundError,
  LibraryWriteConflictError,
} from "./firestoreLibraryWrites.js";

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}
function validId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 1500 &&
    id !== "." && id !== ".." && !id.includes("/");
}

export async function deleteUserLibraryRecord({
  db, uid, collection, id, expectedUpdateTime, now = () => new Date().toISOString(),
}) {
  if (!db || typeof db.collection !== "function" || typeof db.commitWrites !== "function") {
    throw new TypeError("An atomic Firestore client is required");
  }
  if (!validUid(uid) || !["books", "shelves"].includes(collection) || !validId(id)) {
    throw new TypeError("A valid owner-scoped library record is required");
  }
  const ref = db.collection("users").doc(uid).collection(collection).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.deletedAt) throw new LibraryRecordNotFoundError();
  if (!snapshot.updateTime || typeof expectedUpdateTime !== "string" ||
      expectedUpdateTime !== snapshot.updateTime) throw new LibraryWriteConflictError();
  const source = snapshot.data() || {};
  const timestamp = now();
  const writes = [];

  if (collection === "shelves") {
    const books = await db.collection("users").doc(uid).collection("books").limit(101).get();
    const documents = books.docs || [];
    if (documents.length > 100) {
      throw new LibraryWriteConflictError("This shelf has too many books to safely remove in one operation");
    }
    for (const book of documents) {
      const row = book.data() || {};
      if (row.deletedAt || !Array.isArray(row.shelfIds) || !row.shelfIds.includes(id)) continue;
      if (!book.updateTime) throw new LibraryWriteConflictError("A book changed; reload and try again");
      writes.push({
        type: "update",
        path: `users/${uid}/books/${book.id}`,
        updateTime: book.updateTime,
        data: { shelfIds: row.shelfIds.filter((shelfId) => shelfId !== id), updatedAt: timestamp },
      });
    }
  }

  writes.push({
    type: "update",
    path: `users/${uid}/${collection}/${id}`,
    updateTime: snapshot.updateTime,
    data: {
      deletedAt: timestamp,
      updatedAt: timestamp,
      shareEnabled: false,
      shareAudience: source.shareAudience === "selected" ? "selected" : "circle",
      sharedWithUids: [],
      shareLinkId: null,
      ...(collection === "books" && source.cover_storage_key ? { coverCleanupPending: true } : {}),
    },
  });

  if (typeof source.shareLinkId === "string" && source.shareLinkId) {
    const link = await db.collection("shareLinks").doc(source.shareLinkId).get();
    if (link.exists && link.data()?.enabled === true) {
      if (!link.updateTime) throw new LibraryWriteConflictError();
      writes.push({
        type: "update",
        path: `shareLinks/${source.shareLinkId}`,
        updateTime: link.updateTime,
        data: { enabled: false, revokedAt: timestamp },
      });
    }
  }

  try {
    await db.commitWrites(writes);
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412, "ALREADY_EXISTS"].includes(error?.code)) {
      throw new LibraryWriteConflictError();
    }
    throw error;
  }
  return {
    id, collection, deleted: true, deletedAt: timestamp,
    coverCleanupPending: collection === "books" && Boolean(source.cover_storage_key),
    detachedBookCount: collection === "shelves" ? writes.filter((write) => write.path.includes("/books/")).length : 0,
  };
}
