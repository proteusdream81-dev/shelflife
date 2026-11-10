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
  constructor() { super("This relationship changed; refresh and try again"); this.name = "SocialGraphConflictError"; }
}

async function requireProfile(db, uid) {
  const [snapshot, identityLink] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("identityLinks").doc(uid).get(),
  ]);
  const link = identityLink.exists ? identityLink.data() || {} : {};
  if (!snapshot.exists || link.status !== "verified" ||
      typeof link.base44UserId !== "string" || !link.base44UserId ||
      link.base44UserId.length > 128) {
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
  const records = documents.map((document) => {
    const source = document.data() || {};
    return {
      id: document.id,
      readerUid: direction === "following" ? source.followingUid : source.followerUid,
      status: source.status,
      createdAt: source.createdAt || null,
      updatedAt: source.updatedAt || null,
    };
  }).filter((record) => typeof record.readerUid === "string" &&
    ["pending", "accepted"].includes(record.status) && !blockedUids.has(record.readerUid));
  return {
    direction,
    count: records.length,
    records,
    nextCursor: documents.length === limit ? documents[documents.length - 1]?.id || null : null,
  };
}
