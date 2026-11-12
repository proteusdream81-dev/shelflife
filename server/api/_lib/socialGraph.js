
import { createHash } from "node:crypto";

const MAX_UID_LENGTH = 128;

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= MAX_UID_LENGTH &&
    uid !== "." && uid !== ".." && !uid.includes("/") && !/[\u0000-\u001f\u007f]/.test(uid);
}

function relationshipId(followerUid, followingUid) {
  return createHash("sha256").update(`${followerUid}\0${followingUid}`).digest("hex");
}

function blockId(blockerUid, blockedUid) {
  return createHash("sha256").update(`${blockerUid}\0${blockedUid}`).digest("hex");
}

export class SocialGraphInputError extends Error {
  constructor(message) { super(message); this.name = "SocialGraphInputError"; }
}
export class SocialGraphNotFoundError extends Error {
  constructor() { super("Social graph record not found"); this.name = "SocialGraphNotFoundError"; }
}
export class SocialGraphPermissionError extends Error {
  constructor(message = "You are not allowed to change this relationship") {
    super(message); this.name = "SocialGraphPermissionError";
  }
}
export class SocialGraphConflictError extends Error {
  constructor(message = "This relationship changed; refresh and try again") {
    super(message); this.name = "SocialGraphConflictError";
  }
}

async function requireProfile(db, uid) {
  const [snapshot, identityLink] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("identityLinks").doc(uid).get(),
  ]);
  const link = identityLink.exists ? identityLink.data() || {} : {};
  if (!snapshot.exists || link.status !== "verified" ||
      typeof link.base44UserId !== "string" || !link.base44UserId ||
      link.base44UserId.length > 128 || link.base44UserId.includes("/") ||
      link.base44UserId === "." || link.base44UserId === "..") {
    throw new SocialGraphNotFoundError();
  }
  const reverseSnapshot = await db.collection("legacyIdentityLinks").doc(link.base44UserId).get();
  const reverseLink = reverseSnapshot.exists ? reverseSnapshot.data() || {} : {};
  if (reverseLink.status !== "verified" || reverseLink.firebaseUid !== uid) {
    throw new SocialGraphNotFoundError();
  }
  return snapshot.data() || {};
}

async function assertNotBlocked(db, firstUid, secondUid) {
  const [forward, reverse] = await Promise.all([
    db.collection("blocks").doc(blockId(firstUid, secondUid)).get(),
    db.collection("blocks").doc(blockId(secondUid, firstUid)).get(),
  ]);
  if (forward.exists || reverse.exists) {
    throw new SocialGraphPermissionError("This relationship is unavailable");
  }
}

export async function createFollowRequest({ db, followerUid, followingUid, now = () => new Date().toISOString() }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (!validUid(followerUid) || !validUid(followingUid) || followerUid === followingUid) {
    throw new SocialGraphInputError("A different valid reader account is required");
  }
  const [followerProfile, followingProfile] = await Promise.all([
    requireProfile(db, followerUid),
    requireProfile(db, followingUid),
  ]);
  await assertNotBlocked(db, followerUid, followingUid);

  const id = relationshipId(followerUid, followingUid);
  const ref = db.collection("relationships").doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    const record = existing.data() || {};
    if (record.followerUid !== followerUid || record.followingUid !== followingUid) {
      throw new SocialGraphConflictError();
    }
    return { id, status: record.status, alreadyExists: true };
  }

  const timestamp = now();
  const status = followingProfile.profileHidden === true ? "pending" : "accepted";
  try {
    await ref.create({
      followerUid,
      followingUid,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: 1,
    });
  } catch (error) {
    if (!["ALREADY_EXISTS", 409].includes(error?.code)) throw error;
    const raced = await ref.get();
    const record = raced.exists ? raced.data() : null;
    if (!record || record.followerUid !== followerUid || record.followingUid !== followingUid) {
      throw new SocialGraphConflictError();
    }
    return { id, status: record.status, alreadyExists: true };
  }
  return { id, status, alreadyExists: false, followerDisplayName: followerProfile.displayName || "" };
}

export async function acceptFollowRequest({ db, relationshipId: id, actorUid, now = () => new Date().toISOString() }) {
  if (!validUid(actorUid) || typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
    throw new SocialGraphInputError("A valid relationship ID is required");
  }
  const ref = db.collection("relationships").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new SocialGraphNotFoundError();
  const record = snapshot.data() || {};
  if (record.followingUid !== actorUid || record.status !== "pending") {
    throw new SocialGraphPermissionError();
  }
  await Promise.all([requireProfile(db, record.followerUid), requireProfile(db, record.followingUid)]);
  await assertNotBlocked(db, record.followerUid, record.followingUid);
  if (!snapshot.updateTime) throw new SocialGraphConflictError();
  try {
    const updated = await ref.update({ status: "accepted", updatedAt: now() }, { lastUpdateTime: snapshot.updateTime });
    return { id, status: "accepted", version: updated?.updateTime || null };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new SocialGraphConflictError();
    }
    throw error;
  }
}

export async function removeFollowRelationship({ db, relationshipId: id, actorUid }) {
  if (!validUid(actorUid) || typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
    throw new SocialGraphInputError("A valid relationship ID is required");
  }
  const ref = db.collection("relationships").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { removed: false };
  const record = snapshot.data() || {};
  if (record.followerUid !== actorUid && record.followingUid !== actorUid) {
    throw new SocialGraphPermissionError();
  }
  if (!snapshot.updateTime) throw new SocialGraphConflictError();
  try {
    await ref.delete({ lastUpdateTime: snapshot.updateTime });
    return { removed: true };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new SocialGraphConflictError();
    }
    if (["NOT_FOUND", 404].includes(error?.code)) return { removed: false };
    throw error;
  }
}

export async function blockReader({ db, blockerUid, blockedUid, now = () => new Date().toISOString() }) {
  if (!validUid(blockerUid) || !validUid(blockedUid) || blockerUid === blockedUid) {
    throw new SocialGraphInputError("A different valid reader account is required");
  }
  await requireProfile(db, blockerUid);
  await requireProfile(db, blockedUid);
  const id = blockId(blockerUid, blockedUid);
  const ref = db.collection("blocks").doc(id);
  const existing = await ref.get();
  let alreadyBlocked = existing.exists;
  if (existing.exists) {
    const record = existing.data() || {};
    if (record.blockerUid !== blockerUid || record.blockedUid !== blockedUid) {
      throw new SocialGraphConflictError();
    }
  } else {
    try {
      await ref.create({ blockerUid, blockedUid, createdAt: now(), schemaVersion: 1 });
    } catch (error) {
      if (!["ALREADY_EXISTS", 409].includes(error?.code)) throw error;
      const raced = await ref.get();
      const record = raced.exists ? raced.data() : null;
      if (!record || record.blockerUid !== blockerUid || record.blockedUid !== blockedUid) {
        throw new SocialGraphConflictError();
      }
      alreadyBlocked = true;
    }
  }

  // Persist the block before cleanup so any partial cleanup still fails closed.
  for (const [followerUid, followingUid] of [[blockerUid, blockedUid], [blockedUid, blockerUid]]) {
    const relation = db.collection("relationships").doc(relationshipId(followerUid, followingUid));
    const snapshot = await relation.get();
    if (snapshot.exists && snapshot.updateTime) {
      await relation.delete({ lastUpdateTime: snapshot.updateTime }).catch((error) => {
        if (!["NOT_FOUND", 404, "FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) throw error;
      });
    }
  }
  return { blocked: true, alreadyBlocked };
}

export async function unblockReader({ db, blockerUid, blockedUid }) {
  if (!validUid(blockerUid) || !validUid(blockedUid) || blockerUid === blockedUid) {
    throw new SocialGraphInputError("A different valid reader account is required");
  }
  const ref = db.collection("blocks").doc(blockId(blockerUid, blockedUid));
  const snapshot = await ref.get();
  if (!snapshot.exists) return { unblocked: false };
  const record = snapshot.data() || {};
  if (record.blockerUid !== blockerUid) throw new SocialGraphPermissionError();
  if (!snapshot.updateTime) throw new SocialGraphConflictError();
  try {
    await ref.delete({ lastUpdateTime: snapshot.updateTime });
    return { unblocked: true };
  } catch (error) {
    if (["FAILED_PRECONDITION", "ABORTED", 409, 412].includes(error?.code)) {
      throw new SocialGraphConflictError();
    }
    if (["NOT_FOUND", 404].includes(error?.code)) return { unblocked: false };
    throw error;
  }
}


function normalizeReaderName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * Return exact email/username or normalized full-name reader projections. Hidden,
 * blocked, unlinked and ambiguous profiles are indistinguishable from a non-match.
 * Name matching uses the migration-generated bigram index, then verifies the full
 * normalized substring against the actual display name before returning a profile.
 *
 * @param {{ db: any, viewerUid: string, username?: string, nameQuery?: string, emailUser?: { uid: string, emailVerified: boolean } | null, emailFallback?: string }} options
 */
export async function searchReader({ db, viewerUid, username = null, nameQuery = null, emailLookup = false, emailUser = null, emailFallback = "" }) {
  if (!validUid(viewerUid)) throw new SocialGraphInputError("A valid reader account is required");
  const byEmail = emailLookup === true || emailUser !== null;
  const byName = typeof nameQuery === "string";
  if (Number(byEmail) + Number(byName) + Number(typeof username === "string") > 1) {
    throw new SocialGraphInputError("Provide only one reader search method");
  }
  if (byEmail && (typeof emailUser?.uid !== "string" || !validUid(emailUser.uid) || emailUser.emailVerified !== true)) {
    return { readers: [] };
  }
  if (byName) {
    nameQuery = normalizeReaderName(nameQuery);
    if (nameQuery.length < 2 || nameQuery.length > 40) {
      throw new SocialGraphInputError("A reader name search must be 2-40 characters");
    }
  } else if (!byEmail && (typeof username !== "string" || !/^[a-z0-9_]{3,20}$/.test(username))) {
    throw new SocialGraphInputError("A valid exact username is required");
  }

  let candidates;
  if (byEmail) {
    candidates = [{ id: emailUser.uid }];
  } else if (byName) {
    const snapshot = await db.collection("users")
      .where("nameSearchTokens", "array-contains", nameQuery.slice(0, 2)).limit(100).get();
    candidates = (snapshot.docs || []).filter((document) => {
      const candidate = document.data() || {};
      return document.id !== viewerUid && candidate.profileHidden !== true &&
        normalizeReaderName(candidate.displayName).includes(nameQuery);
    }).slice(0, 20).map((document) => ({ id: document.id }));
  } else {
    const reservation = await db.collection("usernameReservations").doc(username).get();
    const reservedUid = reservation.exists ? reservation.data()?.uid : null;
    if (!validUid(reservedUid)) return { readers: [] };
    candidates = [{ id: reservedUid }];
  }

  const readers = [];
  for (const candidate of candidates) {
    const targetUid = candidate.id;
    if (!validUid(targetUid) || targetUid === viewerUid) continue;
    let profile;
    try {
      profile = await requireProfile(db, targetUid);
    } catch (error) {
      if (error instanceof SocialGraphNotFoundError) continue;
      throw error;
    }
    if (profile.profileHidden === true || (byName && !normalizeReaderName(profile.displayName).includes(nameQuery))) continue;
    try {
      await assertNotBlocked(db, viewerUid, targetUid);
    } catch (error) {
      if (error instanceof SocialGraphPermissionError) continue;
      throw error;
    }

    const [relationship, shelves] = await Promise.all([
      db.collection("relationships").doc(relationshipId(viewerUid, targetUid)).get(),
      db.collection("users").doc(targetUid).collection("shelves")
        .where("shareEnabled", "==", true).limit(300).get(),
    ]);
    const relationshipRecord = relationship.exists ? relationship.data() || {} : {};
    const state = relationshipRecord.followerUid === viewerUid && relationshipRecord.followingUid === targetUid
      ? (relationshipRecord.status === "pending" ? "pending" : "accepted")
      : "none";
    const sharedShelves = (shelves.docs || []).filter((document) => {
      const shelf = document.data() || {};
      return shelf.isPrivate !== true && shelf.shareAudience !== "selected";
    }).length;
    readers.push({
      id: targetUid,
      name: profile.displayName || (byEmail ? emailFallback : "Reader") || "Reader",
      username: profile.username || "",
      shared_shelves: sharedShelves,
      state,
    });
    if (!byName) break;
    if (readers.length >= 10) break;
  }
  return { readers: readers.slice(0, byName ? 10 : 1) };
}


/**
 * Check whether an exact username can be claimed by the authenticated reader.
 * The reservation index is authoritative; an existing reservation is available
 * only to its current owner. This endpoint does not create or modify reservations.
 *
 * @param {{ db: any, viewerUid: string, username: string }} options
 */
export async function checkUsernameAvailability({ db, viewerUid, username }) {
  if (!validUid(viewerUid)) throw new SocialGraphInputError("A valid reader account is required");
  if (typeof username !== "string" || !/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new SocialGraphInputError("A username is 3-20 letters, numbers or underscores");
  }
  const reservation = await db.collection("usernameReservations").doc(username).get();
  if (!reservation.exists) return { username, available: true };
  const reservedUid = reservation.data()?.uid;
  return { username, available: validUid(reservedUid) && reservedUid === viewerUid };
}

export { relationshipId, blockId };


export async function listUserRelationships({ db, uid, direction = "following", limit = 50, cursor = null }) {
  if (!validUid(uid)) throw new SocialGraphInputError("A valid reader account is required");
  if (!["following", "followers"].includes(direction)) {
    throw new SocialGraphInputError("Direction must be following or followers");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new SocialGraphInputError("Page size must be between 1 and 100");
  }
  if (cursor !== null && (typeof cursor !== "string" || !/^[a-f0-9]{64}$/.test(cursor))) {
    throw new SocialGraphInputError("Invalid relationship cursor");
  }
  let query = db.collection("relationships")
    .where(direction === "following" ? "followerUid" : "followingUid", "==", uid)
    .limit(limit);
  if (cursor !== null) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const documents = snapshot.docs || [];
  const [blockedByMe, blockingMe] = await Promise.all([
    db.collection("blocks").where("blockerUid", "==", uid).limit(100).get(),
    db.collection("blocks").where("blockedUid", "==", uid).limit(100).get(),
  ]);
  if ((blockedByMe.docs || []).length >= 100 || (blockingMe.docs || []).length >= 100) {
    throw new SocialGraphConflictError("Block list exceeds the safe validation limit");
  }
  const blockedUids = new Set([
    ...(blockedByMe.docs || []).map((document) => document.data()?.blockedUid),
    ...(blockingMe.docs || []).map((document) => document.data()?.blockerUid),
  ]);
  const records = (await Promise.all(documents.map(async (document) => {
    const source = document.data() || {};
    const readerUid = direction === "following" ? source.followingUid : source.followerUid;
    if (typeof readerUid !== "string" || !["pending", "accepted"].includes(source.status) || blockedUids.has(readerUid)) return null;
    const readerProfile = await db.collection("users").doc(readerUid).get();
    const profile = readerProfile.exists ? readerProfile.data() || {} : {};
    return {
      id: document.id,
      readerUid,
      displayName: typeof profile.displayName === "string" && profile.displayName.trim()
        ? profile.displayName.trim().slice(0, 80) : "Reader",
      status: source.status,
      createdAt: source.createdAt || null,
      updatedAt: source.updatedAt || null,
    };
  }))).filter(Boolean);
  return {
    direction,
    count: records.length,
    records,
    nextCursor: documents.length === limit ? documents[documents.length - 1]?.id || null : null,
  };
}


/**
 * Build the legacy readingCircle overview projection from verified Firestore
 * relationships, blocks and public shelf metadata. Queries are bounded so a
 * large social graph fails closed rather than silently truncating.
 *
 * @param {{ db: any, uid: string }} options
 */
export async function getReadingCircleOverview({ db, uid }) {
  if (!db || typeof db.collection !== "function" || typeof db.collectionGroup !== "function") {
    throw new TypeError("A Firestore database with collection-group queries is required");
  }
  if (!validUid(uid)) throw new SocialGraphInputError("A valid reader account is required");
  await requireProfile(db, uid);

  const readBounded = async (query, label, maximum = 100) => {
    const snapshot = await query.limit(maximum + 1).get();
    const docs = snapshot.docs || [];
    if (docs.length > maximum) throw new SocialGraphConflictError(`${label} exceeds the safe overview limit`);
    return docs;
  };
  const [followingDocs, followerDocs, blockedByMeDocs, blockingMeDocs, shelfDocs] = await Promise.all([
    readBounded(db.collection("relationships").where("followerUid", "==", uid), "Following list"),
    readBounded(db.collection("relationships").where("followingUid", "==", uid), "Follower list"),
    readBounded(db.collection("blocks").where("blockerUid", "==", uid), "Block list"),
    readBounded(db.collection("blocks").where("blockedUid", "==", uid), "Block list"),
    readBounded(db.collectionGroup("shelves").where("shareEnabled", "==", true), "Shared shelf directory", 300),
  ]);

  const blockedByMe = new Set(blockedByMeDocs.map((document) => document.data()?.blockedUid).filter(validUid));
  const blockedMe = new Set(blockingMeDocs.map((document) => document.data()?.blockerUid).filter(validUid));
  const blocked = new Set([...blockedByMe, ...blockedMe]);
  const publicShelfCounts = new Map();
  for (const document of shelfDocs) {
    const ownerRef = document.ref?.parent?.parent;
    if (ownerRef?.parent?.id !== "users" || !validUid(ownerRef.id) || ownerRef.id === uid) continue;
    const shelf = document.data() || {};
    if (shelf.deletedAt || shelf.is_private === true || shelf.shareAudience === "selected") continue;
    publicShelfCounts.set(ownerRef.id, (publicShelfCounts.get(ownerRef.id) || 0) + 1);
  }

  const outgoing = new Map();
  const incoming = new Map();
  const resolveRecords = async (documents, direction, destination) => {
    await Promise.all(documents.map(async (document) => {
      const source = document.data() || {};
      const readerUid = direction === "following" ? source.followingUid : source.followerUid;
      if (!validUid(readerUid) || readerUid === uid || !["pending", "accepted"].includes(source.status) || blocked.has(readerUid)) return;
      let profile;
      try {
        profile = await requireProfile(db, readerUid);
      } catch (error) {
        if (error instanceof SocialGraphNotFoundError) return;
        throw error;
      }
      destination.set(readerUid, {
        id: readerUid,
        relationshipId: document.id,
        name: typeof profile.displayName === "string" && profile.displayName.trim()
          ? profile.displayName.trim().slice(0, 80) : "Reader",
        shared_shelves: publicShelfCounts.get(readerUid) || 0,
        status: source.status,
      });
    }));
  };
  await Promise.all([
    resolveRecords(followingDocs, "following", outgoing),
    resolveRecords(followerDocs, "followers", incoming),
  ]);

  const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const following = [...outgoing.values()].filter((record) => record.status === "accepted").sort(byName);
  const followers = [...incoming.values()].filter((record) => record.status === "accepted")
    .map((record) => ({ ...record, you_follow: outgoing.get(record.id)?.status === "accepted" })).sort(byName);
  const requests = [...incoming.values()].filter((record) => record.status === "pending")
    .map(({ id, name, relationshipId }) => ({ id, name, relationshipId })).sort(byName);
  const requested = [...outgoing.values()].filter((record) => record.status === "pending")
    .map(({ id, name, relationshipId }) => ({ id, name, relationshipId })).sort(byName);

  const blockedRecords = await Promise.all([...blockedByMe].map(async (readerUid) => {
    try {
      const profile = await requireProfile(db, readerUid);
      return {
        id: readerUid,
        name: typeof profile.displayName === "string" && profile.displayName.trim()
          ? profile.displayName.trim().slice(0, 80) : "Reader",
      };
    } catch (error) {
      if (error instanceof SocialGraphNotFoundError) return null;
      throw error;
    }
  }));

  const connected = new Set([...outgoing.keys(), ...incoming.keys()]);
  const suggestionUids = [...publicShelfCounts.keys()]
    .filter((readerUid) => !connected.has(readerUid) && !blocked.has(readerUid))
    .sort((a, b) => (publicShelfCounts.get(b) || 0) - (publicShelfCounts.get(a) || 0) || a.localeCompare(b));
  const suggested = [];
  for (const readerUid of suggestionUids) {
    if (suggested.length >= 10) break;
    try {
      const profile = await requireProfile(db, readerUid);
      if (profile.profileHidden === true) continue;
      suggested.push({
        id: readerUid,
        name: typeof profile.displayName === "string" && profile.displayName.trim()
          ? profile.displayName.trim().slice(0, 80) : "Reader",
        username: typeof profile.username === "string" ? profile.username : "",
        shared_shelves: publicShelfCounts.get(readerUid) || 0,
        state: "none",
      });
    } catch (error) {
      if (!(error instanceof SocialGraphNotFoundError)) throw error;
    }
  }

  return {
    following,
    followers,
    suggested,
    requests,
    requested,
    blocked: blockedRecords.filter(Boolean).sort(byName),
  };
}
