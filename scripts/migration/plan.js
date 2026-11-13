
import { createHash, createHmac } from "node:crypto";

const ENTITY_NAMES = Object.freeze([
  "AccountDeletionRequest", "Block", "Book", "BookGroup", "BookSearchCache",
  "ClubSearchCache", "Comment", "Follow", "GroupInvite", "PlacesCache",
  "RateLimitHit", "ReaderSearch", "ReleaseReminder", "Report", "Shelf",
  "User", "Waitlist", "WaitlistAttempt",
]);

const OWNER_FIELD = Object.freeze({
  Book: "created_by_id",
  Shelf: "created_by_id",
  BookGroup: "created_by_id",
  ReleaseReminder: "created_by_id",
  Follow: "follower_id",
  Block: "blocker_id",
  GroupInvite: "inviter_id",
  Comment: "author_id",
  Report: "reporter_id",
});

const SKIP_ENTITIES = new Set([
  "BookSearchCache",
  "ClubSearchCache",
  "PlacesCache",
  "RateLimitHit",
  "ReaderSearch",
  "WaitlistAttempt",
]);

const BOOK_FIELDS = Object.freeze([
  "title", "author", "isbn", "asin", "cover_url", "alt_covers", "description",
  "publisher", "published_date", "page_count", "categories", "buy_links",
  "google_books_id", "hardcover_id", "community_rating", "community_ratings_count",
  "enrichment_status", "edited_fields", "status", "notes", "review", "rating",
  "format", "formats", "series_name", "series_position", "romance_subgenre",
  "spice", "spice_rating", "spice_shared", "content_warnings",
  "share_enabled", "share_audience", "shared_with_names",
]);

const SHELF_FIELDS = Object.freeze([
  "name", "description", "is_private", "share_enabled", "share_audience",
  "shared_with_names",
]);

const USER_FIELDS = Object.freeze([
  "full_name", "username", "profile_hidden", "hide_covers", "show_content_warnings",
  "storefront", "founding_tester_opted_in", "tester_prompt_dismissed",
]);

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function deriveBase44FirestoreUid(base44UserId) {
  if (typeof base44UserId !== "string" || !base44UserId || base44UserId.length > 128 ||
      base44UserId === "." || base44UserId === ".." || base44UserId.includes("/")) {
    throw new TypeError("A valid Base44 user ID is required to derive a Firestore UID");
  }
  return `b44_${hash(`shelflife-base44-v1:${base44UserId}`)}`;
}

export function buildBase44IdentityMappings(users, metadata) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new TypeError("A non-empty source User list is required");
  }
  if (typeof metadata?.snapshotId !== "string" || !metadata.snapshotId.trim() ||
      typeof metadata.exportedAt !== "string" || !Number.isFinite(Date.parse(metadata.exportedAt))) {
    throw new TypeError("A protected source snapshot ID and valid export timestamp are required");
  }
  const seen = new Set();
  return users.map((user) => {
    const base44UserId = user?.id;
    if (typeof base44UserId !== "string" || !base44UserId || base44UserId.length > 128 ||
        base44UserId === "." || base44UserId === ".." || base44UserId.includes("/") ||
        seen.has(base44UserId)) {
      throw new TypeError("Source User IDs must be unique, valid Base44 IDs");
    }
    seen.add(base44UserId);
    return {
      base44UserId,
      firestoreUid: deriveBase44FirestoreUid(base44UserId),
      authProvider: "base44",
      status: "verified",
      proofMethod: "deterministic-base44-principal",
      verifiedAt: metadata.exportedAt,
      verifiedBy: "migration-planner",
    };
  });
}

function safeId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1500 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/");
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.length > 0))];
}

function normalizeNameForSearch(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildNameSearchTokens(value) {
  const normalized = normalizeNameForSearch(value);
  const tokens = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.push(normalized.slice(index, index + 2));
  }
  return uniqueStrings(tokens).slice(0, 128);
}

function requireMappedUid(map, base44Id) {
  if (typeof base44Id !== "string" || !base44Id) return null;
  return map.get(base44Id) || null;
}

function assertSnapshot(snapshot) {
  const metadata = snapshot?.metadata;
  if (!metadata || typeof metadata.snapshotId !== "string" || !metadata.snapshotId.trim()) {
    throw new TypeError("A protected source snapshotId is required");
  }
  if (!metadata.exportedAt || !Number.isFinite(Date.parse(metadata.exportedAt))) {
    throw new TypeError("A valid source exportedAt timestamp is required");
  }
  if (metadata.consistent !== true) {
    throw new TypeError("The source export must be declared as a consistent snapshot");
  }
  if (!snapshot.entities || typeof snapshot.entities !== "object") {
    throw new TypeError("Snapshot entities are required");
  }
  for (const name of ENTITY_NAMES) {
    if (!Array.isArray(snapshot.entities[name])) {
      throw new TypeError(`Snapshot entity array missing: ${name}`);
    }
  }
}

function buildIdentityMap(mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new TypeError("A complete identity mapping list is required");
  }

  const byLegacyId = new Map();
  const usedUids = new Set();

  for (const mapping of mappings) {
    const legacyId = mapping?.base44UserId;
    const uid = mapping?.firestoreUid || mapping?.firebaseUid;
    const proof = mapping?.proofMethod;
    const validIdentityId = (value) => typeof value === "string" &&
      value.length > 0 && value.length <= 128 &&
      value !== "." && value !== ".." && !value.includes("/");
    const isBase44SessionMapping = mapping?.authProvider === "base44" &&
      mapping?.firestoreUid === uid && proof === "deterministic-base44-principal";
    const isFirebaseMapping = !mapping?.authProvider &&
      validIdentityId(mapping?.firebaseUid) &&
      ["dual-session", "operator-verified"].includes(proof);
    if (!validIdentityId(legacyId) || !validIdentityId(uid) ||
        (!isBase44SessionMapping && !isFirebaseMapping)) {
      throw new TypeError("Each identity link requires a valid Base44 ID and an approved Firebase or Base44-session mapping");
    }
    if (mapping.status !== "verified" ||
        !mapping.verifiedBy ||
        !mapping.verifiedAt ||
        !Number.isFinite(Date.parse(mapping.verifiedAt))) {
      throw new TypeError("Every identity mapping must have a verifier and timestamp");
    }
    if (byLegacyId.has(legacyId) || usedUids.has(uid)) {
      throw new TypeError("Identity mapping must be one-to-one; duplicate legacy ID or Firestore UID");
    }
    byLegacyId.set(legacyId, uid);
    usedUids.add(uid);
  }

  return byLegacyId;
}

export function summarizeMigrationPlan(plan) {
  const readinessBlockers = [];
  if (plan.quarantined.length > 0) readinessBlockers.push("quarantined-records");
  if (plan.actorHistoryIncluded !== true) readinessBlockers.push("actor-history-export-missing");
  if (plan.userProfilesCovered !== true) readinessBlockers.push("identity-manifest-does-not-match-source-users");
  return {
    snapshotId: plan.snapshotId,
    schemaVersion: plan.schemaVersion,
    plannedDocuments: plan.documents.length,
    skippedSourceRecords: plan.skipped.length,
    quarantinedSourceRecords: plan.quarantined.length,
    ownerMappingsUsed: plan.ownerMappingsUsed,
    identityMappingCount: plan.identityMappingCount,
    readinessBlockers,
    readyForRehearsal: readinessBlockers.length === 0 && plan.documents.length > 0,
    writesPerformed: 0,
  };
}

/**
 * Produces an in-memory create-only migration plan.
 * It performs no network calls, Firestore writes, deletions or account linking.
 * Callers should print only summarizeMigrationPlan(plan), not the document payloads.
 */
export function buildMigrationPlan({ snapshot, identityMappings, schemaVersion = 1, waitlistEmailKey = null }) {
  assertSnapshot(snapshot);
  if (schemaVersion !== 1) throw new TypeError("Only schemaVersion 1 is supported");

  const identityMap = buildIdentityMap(identityMappings);
  const entities = snapshot.entities;
  const documents = [];
  const skipped = [];
  const quarantined = [];
  const usedLegacyIds = new Set();

  const documentPaths = new Set();
  const userSourceIds = new Set(entities.User.filter((row) => safeId(row?.id)).map((row) => row.id));
  const userProfilesCovered = identityMap.size === userSourceIds.size &&
    [...identityMap.keys()].every((id) => userSourceIds.has(id));

  const bookRows = new Map();
  for (const row of entities.Book) if (safeId(row?.id)) bookRows.set(row.id, row);
  const shelfRows = new Map();
  for (const row of entities.Shelf) if (safeId(row?.id)) shelfRows.set(row.id, row);
  const groupRows = new Map();
  for (const row of entities.BookGroup) if (safeId(row?.id)) groupRows.set(row.id, row);

  const quarantine = (entity, row, reason) => {
    quarantined.push({
      entity,
      sourceId: safeId(row?.id) ? row.id : null,
      reason,
    });
  };

  const add = (entity, sourceId, path, data) => {
    if (!safeId(sourceId) || typeof path !== "string" || path.startsWith("/") || path.includes("//")) {
      quarantine(entity, { id: sourceId }, "invalid-document-path-or-source-id");
      return;
    }
    if (documentPaths.has(path)) {
      quarantine(entity, { id: sourceId }, "duplicate-target-document-path");
      return;
    }
    documentPaths.add(path);
    documents.push({ entity, sourceId, path, data });
  };

  const recordOwner = (entity, row) => {
    const field = OWNER_FIELD[entity];
    const legacyId = field ? row?.[field] : null;
    const uid = requireMappedUid(identityMap, legacyId);
    if (!uid) quarantine(entity, row, field ? `unmapped-or-missing-${field}` : "owner-field-not-defined");
    return uid;
  };

  // Identity links use the exact top-level path and field contract consumed by
  // the server-side resolver. Firestore client rules must keep this collection private.
  for (const mapping of identityMappings) {
    const uid = mapping.firestoreUid || mapping.firebaseUid;
    const base44Only = mapping.authProvider === "base44" && Boolean(mapping.firestoreUid);
    const linkData = {
      base44UserId: mapping.base44UserId,
      status: "verified",
      proofMethod: mapping.proofMethod,
      verifiedAt: mapping.verifiedAt,
      verifiedBy: mapping.verifiedBy,
      sourceSnapshotId: snapshot.metadata.snapshotId,
      ...(base44Only ? { authProvider: "base44", uidType: "base44-derived" } : {}),
    };
    const reverseData = {
      ...(base44Only ? { firestoreUid: uid, authProvider: "base44" } : { firebaseUid: uid }),
      status: "verified",
      proofMethod: mapping.proofMethod,
      verifiedAt: mapping.verifiedAt,
      verifiedBy: mapping.verifiedBy,
      sourceSnapshotId: snapshot.metadata.snapshotId,
    };
    add("IdentityLink", mapping.base44UserId, `identityLinks/${uid}`, linkData);
    add("LegacyIdentityLink", uid, `legacyIdentityLinks/${mapping.base44UserId}`, reverseData);
  }


  // User profile records are mapped only through the supplied verified identity manifest.
  for (const row of entities.User) {
    if (!safeId(row?.id)) {
      quarantine("User", row, "missing-source-id");
      continue;
    }
    const uid = requireMappedUid(identityMap, row.id);
    if (!uid) {
      quarantine("User", row, "unmapped-user");
      continue;
    }
    usedLegacyIds.add(row.id);
    const profile = pick(row, USER_FIELDS);
    const displayName = String(profile.full_name || "").slice(0, 80);
    const data = {
      displayName,
      nameSearchTokens: buildNameSearchTokens(displayName),
      username: profile.username || "",
      profileHidden: profile.profile_hidden === true,
      hideCovers: profile.hide_covers === true,
      showContentWarnings: profile.show_content_warnings === true,
      storefront: profile.storefront || "",
      foundingTesterOptedIn: profile.founding_tester_opted_in === true,
      testerPromptDismissed: profile.tester_prompt_dismissed === true,
      schemaVersion,
      migration: { sourceEntity: "User", sourceId: row.id },
    };
    add("User", row.id, `users/${uid}`, data);
    const username = String(profile.username || "").trim().replace(/^@+/, "").toLowerCase();
    if (username) {
      if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
        quarantine("User", row, "invalid-normalized-username");
      } else {
        add("UsernameReservation", row.id, `usernameReservations/${username}`, {
          uid,
          createdAt: row.updated_date || snapshot.metadata.exportedAt,
        });
      }
    }
  }

  // Shelves first so Books can validate both legacy shelf_id and multi-shelf membership.
  for (const row of entities.Shelf) {
    const uid = recordOwner("Shelf", row);
    if (!uid) continue;
    if (!safeId(row?.id)) {
      quarantine("Shelf", row, "missing-source-id");
      continue;
    }
    const shareAudience = row.share_audience === undefined ? "circle" : row.share_audience;
    if (!["circle", "selected"].includes(shareAudience)) {
      quarantine("Shelf", row, "unsupported-share-audience");
      continue;
    }
    const data = pick(row, SHELF_FIELDS);
    data.is_private = row.is_private === true;
    data.createdAt = row.created_date || snapshot.metadata.exportedAt;
    data.updatedAt = row.updated_date || snapshot.metadata.exportedAt;
    const rawRecipients = uniqueStrings(row.shared_with_ids);
    const mappedRecipients = rawRecipients.map((id) => requireMappedUid(identityMap, id));
    if (mappedRecipients.some((uid) => !uid)) {
      quarantine("Shelf", row, "unmapped-selected-share-recipient");
      continue;
    }
    data.sharedWithUids = mappedRecipients;
    data.shareEnabled = row.share_enabled === true && row.is_private !== true;
    data.shareAudience = shareAudience;
    data.shareLinkId = typeof row.share_token === "string" && row.share_token ? hash(row.share_token) : null;
    delete data.share_enabled;
    delete data.share_audience;
    delete data.shared_with_names;
    data.schemaVersion = schemaVersion;
    data.migration = { sourceEntity: "Shelf", sourceId: row.id };
    add("Shelf", row.id, `users/${uid}/shelves/${row.id}`, data);
    usedLegacyIds.add(row.created_by_id);

    if (data.shareLinkId) {
      const linkEnabled = data.shareEnabled && data.shareAudience === "circle";
      add("ShareLink", row.id, `shareLinks/${data.shareLinkId}`, {
        ownerUid: uid,
        targetKind: "shelf",
        targetId: row.id,
        enabled: linkEnabled,
        createdAt: row.created_date || snapshot.metadata.exportedAt,
        revokedAt: linkEnabled ? null : row.updated_date || snapshot.metadata.exportedAt,
      });
    }
  }

  for (const row of entities.Book) {
    const uid = recordOwner("Book", row);
    if (!uid) continue;
    if (!safeId(row?.id)) {
      quarantine("Book", row, "missing-source-id");
      continue;
    }

    const shelfIds = uniqueStrings([row.shelf_id, ...(Array.isArray(row.shelf_ids) ? row.shelf_ids : [])]);
    const invalidShelf = shelfIds.find((shelfId) => {
      const shelf = shelfRows.get(shelfId);
      return !shelf || requireMappedUid(identityMap, shelf.created_by_id) !== uid;
    });
    if (invalidShelf) {
      quarantine("Book", row, "missing-or-cross-owner-shelf-reference");
      continue;
    }

    const shareAudience = row.share_audience === undefined ? "circle" : row.share_audience;
    if (!["circle", "selected"].includes(shareAudience)) {
      quarantine("Book", row, "unsupported-share-audience");
      continue;
    }
    const data = pick(row, BOOK_FIELDS);
    data.createdAt = row.created_date || snapshot.metadata.exportedAt;
    data.updatedAt = row.updated_date || snapshot.metadata.exportedAt;
    data.shelfIds = shelfIds;
    delete data.shelf_id;
    delete data.shelf_ids;
    const rawRecipients = uniqueStrings(row.shared_with_ids);
    const mappedRecipients = rawRecipients.map((id) => requireMappedUid(identityMap, id));
    if (mappedRecipients.some((uid) => !uid)) {
      quarantine("Book", row, "unmapped-selected-share-recipient");
      continue;
    }
    data.sharedWithUids = mappedRecipients;
    data.shareEnabled = row.share_enabled === true;
    data.shareAudience = shareAudience;
    data.shareLinkId = typeof row.share_token === "string" && row.share_token ? hash(row.share_token) : null;
    delete data.share_enabled;
    delete data.share_audience;
    delete data.shared_with_names;
    delete data.shared_with_ids;
    data.schemaVersion = schemaVersion;
    data.migration = { sourceEntity: "Book", sourceId: row.id };
    add("Book", row.id, `users/${uid}/books/${row.id}`, data);
    usedLegacyIds.add(row.created_by_id);

    if (data.shareLinkId) {
      const linkEnabled = data.shareEnabled && data.shareAudience === "circle";
      add("ShareLink", row.id, `shareLinks/${data.shareLinkId}`, {
        ownerUid: uid,
        targetKind: "book",
        targetId: row.id,
        enabled: linkEnabled,
        createdAt: row.created_date || snapshot.metadata.exportedAt,
        revokedAt: linkEnabled ? null : row.updated_date || snapshot.metadata.exportedAt,
      });
    }
  }

  // Groups: the owner and roster are separate documents, preserving removal history.
  for (const row of entities.BookGroup) {
    const ownerUid = recordOwner("BookGroup", row);
    if (!ownerUid) continue;
    if (!safeId(row?.id)) {
      quarantine("BookGroup", row, "missing-source-id");
      continue;
    }
    const data = pick(row, ["name", "book_title", "description", "category", "location", "meets"]);
    data.ownerUid = ownerUid;
    data.isPrivate = row.is_private === true;
    data.schemaVersion = schemaVersion;
    data.migration = { sourceEntity: "BookGroup", sourceId: row.id };
    add("BookGroup", row.id, `groups/${row.id}`, data);
    usedLegacyIds.add(row.created_by_id);

    const memberIds = uniqueStrings(row.member_ids);
    for (const legacyMemberId of uniqueStrings([row.created_by_id, ...memberIds])) {
      const memberUid = requireMappedUid(identityMap, legacyMemberId);
      if (!memberUid) {
        quarantine("BookGroup", row, "unmapped-group-member");
        continue;
      }
      add("GroupMember", `${row.id}:${legacyMemberId}`,
        `groups/${row.id}/members/${memberUid}`, {
          uid: memberUid,
          role: memberUid === ownerUid ? "owner" : "member",
          status: "active",
          joinedAt: snapshot.metadata.exportedAt,
        });
    }
    for (const legacyBlockedId of uniqueStrings(row.blocked_ids)) {
      const blockedUid = requireMappedUid(identityMap, legacyBlockedId);
      if (!blockedUid) {
        quarantine("BookGroup", row, "unmapped-removed-group-member");
        continue;
      }
      add("GroupRemoved", `${row.id}:${legacyBlockedId}`,
        `groups/${row.id}/removed/${blockedUid}`, {
          uid: blockedUid,
          removedAt: snapshot.metadata.exportedAt,
          reason: "legacy-owner-removal",
        });
    }
  }

  for (const row of entities.Follow) {
    const followerUid = requireMappedUid(identityMap, row?.follower_id);
    const followingUid = requireMappedUid(identityMap, row?.following_id);
    if (!followerUid || !followingUid) {
      quarantine("Follow", row, "unmapped-follow-endpoint");
      continue;
    }
    if (followerUid === followingUid) {
      quarantine("Follow", row, "self-follow-relationship");
      continue;
    }
    // Historical rows predate follow requests and have no status; preserve the
    // documented legacy default. Explicit unknown states must not become accepted.
    const status = row.status === undefined ? "accepted" : row.status;
    if (!["pending", "accepted"].includes(status)) {
      quarantine("Follow", row, "unsupported-follow-status");
      continue;
    }
    const id = hash(`${followerUid}\0${followingUid}`);
    add("Follow", row.id, `relationships/${id}`, {
      followerUid,
      followingUid,
      status,
      createdAt: row.created_date || snapshot.metadata.exportedAt,
      updatedAt: row.updated_date || snapshot.metadata.exportedAt,
    });
    usedLegacyIds.add(row.follower_id);
    usedLegacyIds.add(row.following_id);
  }

  for (const row of entities.Block) {
    const blockerUid = requireMappedUid(identityMap, row?.blocker_id);
    const blockedUid = requireMappedUid(identityMap, row?.blocked_id);
    if (!blockerUid || !blockedUid) {
      quarantine("Block", row, "unmapped-block-endpoint");
      continue;
    }
    if (blockerUid === blockedUid) {
      quarantine("Block", row, "self-block-relationship");
      continue;
    }
    const id = hash(`${blockerUid}\0${blockedUid}`);
    add("Block", row.id, `blocks/${id}`, {
      blockerUid,
      blockedUid,
      createdAt: row.created_date || snapshot.metadata.exportedAt,
    });
    usedLegacyIds.add(row.blocker_id);
    usedLegacyIds.add(row.blocked_id);
  }

  for (const row of entities.GroupInvite) {
    const inviterUid = requireMappedUid(identityMap, row?.inviter_id);
    const inviteeUid = requireMappedUid(identityMap, row?.invitee_id);
    if (!inviterUid || !inviteeUid || !groupRows.has(row?.group_id)) {
      quarantine("GroupInvite", row, "unmapped-user-or-missing-group");
      continue;
    }
    if (inviterUid === inviteeUid) {
      quarantine("GroupInvite", row, "self-group-invitation");
      continue;
    }
    const inviteStatus = row.status === undefined ? "pending" : row.status;
    if (!["pending", "accepted", "declined"].includes(inviteStatus)) {
      quarantine("GroupInvite", row, "unsupported-group-invite-status");
      continue;
    }
    add("GroupInvite", row.id,
      `groups/${row.group_id}/invites/${row.id}`, {
        inviterUid,
        inviteeUid,
        status: inviteStatus,
        createdAt: row.created_date || snapshot.metadata.exportedAt,
      });
    usedLegacyIds.add(row.inviter_id);
    usedLegacyIds.add(row.invitee_id);
  }

  for (const row of entities.ReleaseReminder) {
    const uid = recordOwner("ReleaseReminder", row);
    if (!uid) continue;
    if (!safeId(row?.id)) {
      quarantine("ReleaseReminder", row, "missing-source-id");
      continue;
    }
    const reminderBook = bookRows.get(row.book_id);
    if (!reminderBook || requireMappedUid(identityMap, reminderBook.created_by_id) !== uid) {
      quarantine("ReleaseReminder", row, "missing-or-cross-owner-reminder-book");
      continue;
    }
    add("ReleaseReminder", row.id, `users/${uid}/releaseReminders/${row.id}`, {
      bookId: row.book_id || "",
      title: row.title || "",
      author: row.author || "",
      releaseDate: row.release_date || "",
      calendarEventId: row.event_id || "",
      syncStatus: "needs-reconciliation",
      schemaVersion,
      migration: { sourceEntity: "ReleaseReminder", sourceId: row.id },
    });
    usedLegacyIds.add(row.created_by_id);
  }

  for (const row of entities.Comment) {
    const ownerUid = requireMappedUid(identityMap, row?.owner_id);
    const authorUid = requireMappedUid(identityMap, row?.author_id);
    const targetRow = row.target_kind === "book"
      ? bookRows.get(row.target_id)
      : row.target_kind === "shelf" ? shelfRows.get(row.target_id) : null;
    const parentId = String(row.parent_id || "");
    const parentRow = parentId
      ? entities.Comment.find((comment) =>
          comment.id === parentId &&
          comment.target_kind === row.target_kind &&
          comment.target_id === row.target_id)
      : null;
    if (!ownerUid || !authorUid || !targetRow ||
        requireMappedUid(identityMap, targetRow.created_by_id) !== ownerUid ||
        !["book", "shelf"].includes(row.target_kind) || !safeId(row.target_id) ||
        (parentId && !parentRow)) {
      quarantine("Comment", row, "unmapped-comment-party-invalid-target-or-parent-reference");
      continue;
    }
    add("Comment", row.id, `comments/${row.id}`, {
      targetKind: row.target_kind,
      targetId: row.target_id,
      ownerUid,
      authorUid,
      authorName: row.author_name || "",
      body: String(row.body || "").slice(0, 2000),
      parentId: row.parent_id || "",
      createdAt: row.created_date || snapshot.metadata.exportedAt,
      schemaVersion,
    });
    usedLegacyIds.add(row.owner_id);
    usedLegacyIds.add(row.author_id);
  }

  for (const row of entities.Report) {
    const reporterUid = requireMappedUid(identityMap, row?.reporter_id);
    const authorUid = requireMappedUid(identityMap, row?.author_id);
    if (!reporterUid || !authorUid || !safeId(row.comment_id)) {
      quarantine("Report", row, "unmapped-report-party-or-invalid-comment");
      continue;
    }
    const reportedComment = entities.Comment.find((comment) => comment.id === row.comment_id);
    if (!reportedComment || reportedComment.author_id !== row.author_id) {
      quarantine("Report", row, "missing-or-inconsistent-reported-comment");
      continue;
    }
    add("Report", row.id, `moderationReports/${row.id}`, {
      kind: row.kind || "comment",
      commentId: row.comment_id,
      targetKind: row.target_kind || "",
      targetId: row.target_id || "",
      authorUid,
      authorName: row.author_name || "",
      reporterUid,
      reporterName: row.reporter_name || "",
      reason: String(row.reason || "").slice(0, 500),
      excerpt: String(row.excerpt || "").slice(0, 400),
      createdAt: row.created_date || snapshot.metadata.exportedAt,
      status: "open",
      schemaVersion,
    });
    usedLegacyIds.add(row.reporter_id);
    usedLegacyIds.add(row.author_id);
  }

  for (const row of entities.Waitlist) {
    const email = String(row?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      quarantine("Waitlist", row, "invalid-waitlist-email");
      continue;
    }
    if (typeof waitlistEmailKey !== "string" || Buffer.byteLength(waitlistEmailKey, "utf8") < 32) {
      quarantine("Waitlist", row, "waitlist-email-hmac-key-required");
      continue;
    }
    const emailHash = createHmac("sha256", waitlistEmailKey).update(email).digest("hex");
    add("Waitlist", row.id || emailHash, `waitlist/${emailHash}`, {
      email,
      name: String(row.name || "").slice(0, 80),
      source: String(row.source || "").slice(0, 100),
      foundingTesterConsent: row.founding_tester_consent === true,
      confirmed: row.confirmed === true,
      confirmationTokenHash: row.confirm_token ? hash(row.confirm_token) : "",
      confirmationSends: Number(row.confirm_sends || 0),
      confirmationLastSentAt: row.confirm_last_sent_at || null,
      schemaVersion,
    });
  }

  // Account-deletion challenges are never copied to the new identity store. A still-live request
  // must be processed by the source account-deletion workflow before migration can proceed.
  const now = Date.now();
  for (const row of entities.AccountDeletionRequest) {
    const expiresAt = Date.parse(row?.expires_at || "");
    if (!row.used && Number.isFinite(expiresAt) && expiresAt > now) {
      quarantine("AccountDeletionRequest", row, "unexpired-deletion-request-must-be-processed-at-source");
    } else {
      skipped.push({ entity: "AccountDeletionRequest", sourceId: safeId(row?.id) ? row.id : null, reason: "expired-or-consumed-deletion-request" });
    }
  }

  // These records are intentionally not migrated; they are ephemeral or rebuildable.
  for (const entity of SKIP_ENTITIES) {
    for (const row of entities[entity]) skipped.push({ entity, sourceId: safeId(row?.id) ? row.id : null });
  }

  // Actor state is not an entity export. An array alone is not proof that every room was
  // enumerated or that writes were quiesced. Require a separate operator-attested manifest
  // before any chat history is scheduled for import.
  const actorMessageCount = Array.isArray(snapshot.actorMessages) ? snapshot.actorMessages.length : null;
  const actorExport = snapshot.metadata.actorHistoryExport;
  const enumeratedGroupIds = Array.isArray(actorExport?.enumeratedGroupIds)
    ? actorExport.enumeratedGroupIds : [];
  const expectedGroupIds = [...groupRows.keys()];
  const actorHistoryIncluded = actorMessageCount !== null &&
    actorExport?.complete === true &&
    actorExport?.writeQuiesced === true &&
    actorExport?.retentionLimitPerRoom === 300 &&
    actorExport?.messageCount === actorMessageCount &&
    typeof actorExport?.exportedBy === "string" && actorExport.exportedBy.trim().length > 0 &&
    typeof actorExport?.exporterVersion === "string" && actorExport.exporterVersion.trim().length > 0 &&
    typeof actorExport?.exportedAt === "string" && Number.isFinite(Date.parse(actorExport.exportedAt)) &&
    enumeratedGroupIds.every((id) => safeId(id)) &&
    new Set(enumeratedGroupIds).size === enumeratedGroupIds.length &&
    enumeratedGroupIds.length === expectedGroupIds.length &&
    expectedGroupIds.every((id) => enumeratedGroupIds.includes(id));

  if (actorMessageCount === null) {
    skipped.push({ entity: "BookGroupRoom.actorMessages", sourceId: null, reason: "actor-export-not-provided" });
  } else if (!actorHistoryIncluded) {
    skipped.push({ entity: "BookGroupRoom.actorMessages", sourceId: null, reason: "actor-export-attestation-missing-or-incomplete" });
  } else {
    const messagesPerGroup = new Map();
    for (const message of snapshot.actorMessages) {
      const group = groupRows.get(message?.group_id);
      if (!group || !safeId(message?.id)) {
        quarantine("BookGroupRoom.actorMessages", message, "missing-group-or-message-id");
        continue;
      }
      const groupMessageCount = (messagesPerGroup.get(message.group_id) || 0) + 1;
      messagesPerGroup.set(message.group_id, groupMessageCount);
      if (groupMessageCount > actorExport.retentionLimitPerRoom) {
        quarantine("BookGroupRoom.actorMessages", message, "room-message-retention-limit-exceeded");
        continue;
      }
      const authorUid = requireMappedUid(identityMap, message.author_id);
      if (!authorUid) {
        quarantine("BookGroupRoom.actorMessages", message, "unmapped-message-author");
        continue;
      }
      const createdAt = message.at === undefined || message.at === null || message.at === ""
        ? new Date(snapshot.metadata.exportedAt)
        : new Date(message.at);
      if (!Number.isFinite(createdAt.getTime())) {
        quarantine("BookGroupRoom.actorMessages", message, "invalid-message-timestamp");
        continue;
      }
      add("GroupMessage", message.id,
        `groups/${message.group_id}/messages/${message.id}`, {
          authorUid,
          displayName: String(message.author_name || "").slice(0, 60),
          body: String(message.body || "").slice(0, 1000),
          createdAt: createdAt.toISOString(),
          schemaVersion,
        });
    }
  }

  return {
    snapshotId: snapshot.metadata.snapshotId,
    exportedAt: snapshot.metadata.exportedAt,
    schemaVersion,
    documents,
    skipped,
    quarantined,
    ownerMappingsUsed: usedLegacyIds.size,
    identityMappingCount: identityMap.size,
    actorHistoryIncluded,
    userProfilesCovered,
    applyMode: "disabled",
  };
}
