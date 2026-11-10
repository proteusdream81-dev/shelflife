import { createHash, randomBytes } from "node:crypto";

const MAX_RECIPIENTS = 50;
const BOOK_PUBLIC_FIELDS = Object.freeze([
  "title", "author", "isbn", "asin", "cover_url", "alt_covers", "description",
  "publisher", "published_date", "page_count", "categories", "format", "formats",
  "series_name", "series_position", "romance_subgenre", "content_warnings",
  "spice_rating", "spice_shared",
]);
const SHELF_PUBLIC_FIELDS = Object.freeze(["name", "description", "createdAt"]);

function validUid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value !== "." && value !== ".." && !value.includes("/") && !/[\u0000-\u001f\u007f]/.test(value);
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 &&
    value !== "." && value !== ".." && !value.includes("/");
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function relationshipId(firstUid, secondUid) {
  return hash(`${firstUid}\0${secondUid}`);
}
function blockId(firstUid, secondUid) {
  return hash(`${firstUid}\0${secondUid}`);
}

export class SharingInputError extends Error {
  constructor(message) { super(message); this.name = "SharingInputError"; }
}
export class SharingNotFoundError extends Error {
  constructor() { super("Shared item not found"); this.name = "SharingNotFoundError"; }
}
export class SharingPermissionError extends Error {
  constructor(message = "You are not allowed to share this item") {
    super(message); this.name = "SharingPermissionError";
  }
}
export class SharingConflictError extends Error {
  constructor(message = "Sharing settings changed; reload and try again") {
    super(message); this.name = "SharingConflictError";
  }
}

async function requireVerifiedReader(db, uid) {
  if (!validUid(uid)) throw new SharingInputError("A valid reader account is required");
  const [profile, forward] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("identityLinks").doc(uid).get(),
  ]);
  const link = forward.exists ? forward.data() || {} : {};
  if (!profile.exists || link.status !== "verified" || !validUid(link.base44UserId)) {
    throw new SharingPermissionError("Reader account is not fully migrated");
  }
  const reverse = await db.collection("legacyIdentityLinks").doc(link.base44UserId).get();
  const reverseLink = reverse.exists ? reverse.data() || {} : {};
  if (reverseLink.status !== "verified" || reverseLink.firebaseUid !== uid) {
    throw new SharingPermissionError("Reader account identity is not verified");
  }
}

async function assertCircleConnection(db, ownerUid, recipientUid) {
  const [forward, reverse, blockForward, blockReverse] = await Promise.all([
    db.collection("relationships").doc(relationshipId(ownerUid, recipientUid)).get(),
    db.collection("relationships").doc(relationshipId(recipientUid, ownerUid)).get(),
    db.collection("blocks").doc(blockId(ownerUid, recipientUid)).get(),
    db.collection("blocks").doc(blockId(recipientUid, ownerUid)).get(),
  ]);
  if (blockForward.exists || blockReverse.exists) {
    throw new SharingPermissionError("A selected reader is unavailable");
  }
  const connected = [forward, reverse].some((snapshot) =>
    snapshot.exists && snapshot.data()?.status === "accepted");
  if (!connected) throw new SharingPermissionError("Selected readers must be in your Reading Circle");
}

function safePublicBook(document) {
  const source = document.data() || {};
  const result = { id: document.id };
  for (const field of BOOK_PUBLIC_FIELDS) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

export async function updateShareSettings({
  db, uid, collection, id, input, expectedUpdateTime,
  now = () => new Date().toISOString(),
  createToken = () => randomBytes(32).toString("base64url"),
}) {
  if (!db || typeof db.collection !== "function" || typeof db.commitWrites !== "function") {
    throw new TypeError("An atomic Firestore client is required");
  }
  if (!validUid(uid) || !["books", "shelves"].includes(collection) || !validId(id)) {
    throw new SharingInputError("A valid reader and library item are required");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SharingInputError("Sharing settings are required");
  }
  const allowed = new Set(["enabled", "audience", "recipientUids", "linkEnabled"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new SharingInputError("Unsupported sharing field");
  }
  if (typeof input.enabled !== "boolean" || !["circle", "selected"].includes(input.audience) ||
      !Array.isArray(input.recipientUids) || typeof input.linkEnabled !== "boolean") {
    throw new SharingInputError("Sharing settings are incomplete or invalid");
  }
  if (input.recipientUids.length > MAX_RECIPIENTS ||
      input.recipientUids.some((recipient) => !validUid(recipient)) ||
      new Set(input.recipientUids).size !== input.recipientUids.length) {
    throw new SharingInputError("Selected readers must be unique valid accounts (maximum 50)");
  }
  if (!input.enabled && (input.recipientUids.length > 0 || input.linkEnabled)) {
    throw new SharingInputError("Disabled sharing cannot include recipients or a public link");
  }
  if (input.audience === "selected" && input.linkEnabled) {
    throw new SharingInputError("Selected-reader sharing cannot create a public link");
  }
  if (input.enabled && input.audience === "selected" && input.recipientUids.length === 0) {
    throw new SharingInputError("Select at least one reader");
  }
  if (input.audience === "circle" && input.recipientUids.length > 0) {
    throw new SharingInputError("Circle sharing does not use a selected-recipient list");
  }

  await requireVerifiedReader(db, uid);
  const ref = db.collection("users").doc(uid).collection(collection).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new SharingNotFoundError();
  if (typeof expectedUpdateTime !== "string" || !expectedUpdateTime) throw new SharingConflictError("If-Match version is required");
  if (snapshot.updateTime !== expectedUpdateTime) throw new SharingConflictError();
  const source = snapshot.data() || {};
  if (source.deletedAt) throw new SharingNotFoundError();
  if (collection === "shelves" && source.is_private === true && input.enabled) {
    throw new SharingPermissionError("Private shelves cannot be shared");
  }

  if (input.enabled && input.audience === "selected") {
    for (const recipientUid of input.recipientUids) {
      await requireVerifiedReader(db, recipientUid);
      await assertCircleConnection(db, uid, recipientUid);
    }
  }

  const timestamp = now();
  const oldLinkId = typeof source.shareLinkId === "string" ? source.shareLinkId : null;
  const linkEnabled = input.enabled && input.audience === "circle" && input.linkEnabled;
  const token = linkEnabled ? createToken() : null;
  if (token !== null && (typeof token !== "string" || token.length < 20 || token.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(token))) {
    throw new TypeError("Generated share token is invalid");
  }
  const newLinkId = token ? hash(token) : null;
  const writes = [{
    type: "update",
    path: `users/${uid}/${collection}/${id}`,
    updateTime: snapshot.updateTime,
    data: {
      shareEnabled: input.enabled,
      shareAudience: input.audience,
      sharedWithUids: input.enabled && input.audience === "selected" ? input.recipientUids : [],
      shareLinkId: newLinkId,
      updatedAt: timestamp,
    },
  }];

  if (oldLinkId && oldLinkId !== newLinkId) {
    const oldLink = await db.collection("shareLinks").doc(oldLinkId).get();
    if (oldLink.exists && oldLink.data()?.enabled === true) {
      if (!oldLink.updateTime) throw new SharingConflictError();
      writes.push({
        type: "update",
        path: `shareLinks/${oldLinkId}`,
        updateTime: oldLink.updateTime,
        data: { enabled: false, revokedAt: timestamp },
      });
    }
  }
  if (newLinkId) {
    writes.push({
      type: "create",
      path: `shareLinks/${newLinkId}`,
      data: {
        ownerUid: uid,
        targetKind: collection === "books" ? "book" : "shelf",
        targetId: id,
        enabled: true,
        createdAt: timestamp,
        revokedAt: null,
        schemaVersion: 1,
      },
    });
  }

  try {
    const result = await db.commitWrites(writes);
    return {
      shareEnabled: input.enabled,
      shareAudience: input.audience,
      sharedWithUids: input.enabled && input.audience === "selected" ? input.recipientUids : [],
      shareLinkEnabled: Boolean(newLinkId),
      shareLinkToken: token,
      updateTime: result?.writeResults?.[0]?.updateTime || null,
    };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412, "ALREADY_EXISTS"].includes(error?.code)) {
      throw new SharingConflictError();
    }
    throw error;
  }
}

export async function resolvePublicShare({ db, token }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (typeof token !== "string" || token.length < 20 || token.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(token)) throw new SharingNotFoundError();
  const linkId = hash(token);
  const linkSnapshot = await db.collection("shareLinks").doc(linkId).get();
  if (!linkSnapshot.exists) throw new SharingNotFoundError();
  const link = linkSnapshot.data() || {};
  if (link.enabled !== true || link.revokedAt !== null ||
      !validUid(link.ownerUid) || !validId(link.targetId) ||
      !["book", "shelf"].includes(link.targetKind)) throw new SharingNotFoundError();
  const collection = link.targetKind === "book" ? "books" : "shelves";
  const itemSnapshot = await db.collection("users").doc(link.ownerUid).collection(collection).doc(link.targetId).get();
  if (!itemSnapshot.exists) throw new SharingNotFoundError();
  const item = itemSnapshot.data() || {};
  if (item.deletedAt || item.shareEnabled !== true || item.shareAudience !== "circle" ||
      item.shareLinkId !== linkId || (collection === "shelves" && item.is_private === true)) {
    throw new SharingNotFoundError();
  }
  if (link.targetKind === "book") return { kind: "book", item: safePublicBook({ id: link.targetId, data: () => item }) };

  const books = await db.collection("users").doc(link.ownerUid).collection("books").limit(101).get();
  const documents = books.docs || [];
  if (documents.length > 100) throw new SharingConflictError("Shelf contains more than 100 books; use paginated share reads");
  const records = documents
    .filter((document) => !document.data()?.deletedAt && Array.isArray(document.data()?.shelfIds) && document.data().shelfIds.includes(link.targetId))
    .map(safePublicBook);
  const shelf = { id: link.targetId };
  for (const field of SHELF_PUBLIC_FIELDS) {
    if (Object.hasOwn(item, field)) shelf[field] = item[field];
  }
  return { kind: "shelf", item: shelf, books: records };
}


async function shareAccessState(db, ownerUid, viewerUid) {
  const [forward, reverse, blockForward, blockReverse] = await Promise.all([
    db.collection("relationships").doc(relationshipId(ownerUid, viewerUid)).get(),
    db.collection("relationships").doc(relationshipId(viewerUid, ownerUid)).get(),
    db.collection("blocks").doc(blockId(ownerUid, viewerUid)).get(),
    db.collection("blocks").doc(blockId(viewerUid, ownerUid)).get(),
  ]);
  const blocked = blockForward.exists || blockReverse.exists;
  const connected = [forward, reverse].some((snapshot) =>
    snapshot.exists && snapshot.data()?.status === "accepted");
  return { blocked, connected };
}

async function sharedShelfBooks(db, ownerUid, shelfId) {
  const snapshot = await db.collection("users").doc(ownerUid).collection("books").where("shelfIds", "array-contains", shelfId).limit(101).get();
  const docs = snapshot.docs || [];
  if (docs.length > 100) throw new SharingConflictError("Shared shelf contains more than 100 books");
  return docs
    .filter((document) => !document.data()?.deletedAt && Array.isArray(document.data()?.shelfIds) && document.data().shelfIds.includes(shelfId))
    .map(safePublicBook);
}

export async function listSharedWithMe({ db, uid }) {
  if (!db || typeof db.collectionGroup !== "function") throw new TypeError("A Firestore collection-group client is required");
  await requireVerifiedReader(db, uid);
  const candidates = [];
  for (const collection of ["books", "shelves"]) {
    const [selectedPage, enabledPage] = await Promise.all([
      db.collectionGroup(collection).where("sharedWithUids", "array-contains", uid).limit(101).get(),
      db.collectionGroup(collection).where("shareEnabled", "==", true).limit(101).get(),
    ]);
    const selectedDocs = selectedPage.docs || [];
    const enabledDocs = enabledPage.docs || [];
    if (selectedDocs.length > 100 || enabledDocs.length > 100) {
      throw new SharingConflictError("Shared item list exceeds the safe display limit");
    }
    for (const document of [...selectedDocs, ...enabledDocs]) {
      const ownerRef = document.ref?.parent?.parent;
      const usersCollection = ownerRef?.parent;
      if (!validUid(ownerRef?.id) || usersCollection?.id !== "users") continue;
      const source = document.data() || {};
      if (source.deletedAt || source.shareEnabled !== true || (collection === "shelves" && source.is_private === true)) continue;
      const selected = source.shareAudience === "selected" &&
        Array.isArray(source.sharedWithUids) && source.sharedWithUids.includes(uid);
      const circle = source.shareAudience === "circle";
      if (!selected && !circle) continue;
      candidates.push({ collection, ownerUid: ownerRef.id, document, source, audience: selected ? "selected" : "circle" });
    }
  }

  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.collection}/${candidate.ownerUid}/${candidate.document.id}`;
    deduped.set(key, candidate);
  }
  const records = [];
  for (const candidate of deduped.values()) {
    if (candidate.ownerUid === uid) continue;
    await requireVerifiedReader(db, candidate.ownerUid);
    const access = await shareAccessState(db, candidate.ownerUid, uid);
    if (access.blocked || (candidate.audience === "circle" && !access.connected)) continue;
    const ownerProfile = await db.collection("users").doc(candidate.ownerUid).get();
    const ownerData = ownerProfile.exists ? ownerProfile.data() || {} : {};
    const ownerName = typeof ownerData.displayName === "string" && ownerData.displayName.trim()
      ? ownerData.displayName.trim().slice(0, 80) : "Reader";
    const item = candidate.collection === "books"
      ? safePublicBook(candidate.document)
      : {
          id: candidate.document.id,
          ...Object.fromEntries(SHELF_PUBLIC_FIELDS
            .filter((field) => Object.hasOwn(candidate.source, field))
            .map((field) => [field, candidate.source[field]])),
          books: await sharedShelfBooks(db, candidate.ownerUid, candidate.document.id),
        };
    records.push({
      id: hash(`${candidate.ownerUid}\0${candidate.collection}\0${candidate.document.id}`),
      kind: candidate.collection === "books" ? "book" : "shelf",
      audience: candidate.audience,
      ownerName,
      createdAt: candidate.source.createdAt || null,
      item,
    });
  }
  records.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || a.id.localeCompare(b.id));
  return { count: records.length, records };
}


export async function authorizeSharedItem({ db, viewerUid, ownerUid, targetKind, targetId }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validUid(viewerUid) || !validUid(ownerUid) || !validId(targetId) ||
      !["book", "shelf"].includes(targetKind)) {
    throw new SharingInputError("A valid shared item is required");
  }
  await requireVerifiedReader(db, viewerUid);
  await requireVerifiedReader(db, ownerUid);
  const collection = targetKind === "book" ? "books" : "shelves";
  const snapshot = await db.collection("users").doc(ownerUid).collection(collection).doc(targetId).get();
  if (!snapshot.exists) throw new SharingNotFoundError();
  const source = snapshot.data() || {};
  if (viewerUid === ownerUid) return { ownerUid, targetKind, targetId, source, isOwner: true };
  if (source.shareEnabled !== true || (collection === "shelves" && source.is_private === true)) {
    throw new SharingPermissionError("This item is not shared with you");
  }
  const access = await shareAccessState(db, ownerUid, viewerUid);
  if (access.blocked) throw new SharingPermissionError("This shared item is unavailable");
  if (source.shareAudience === "selected") {
    if (!Array.isArray(source.sharedWithUids) || !source.sharedWithUids.includes(viewerUid)) {
      throw new SharingPermissionError("This item is not shared with you");
    }
  } else if (source.shareAudience === "circle") {
    if (!access.connected) throw new SharingPermissionError("This item is available to the owner's Reading Circle");
  } else {
    throw new SharingPermissionError("This item is not shared with you");
  }
  return { ownerUid, targetKind, targetId, source, isOwner: false };
}
