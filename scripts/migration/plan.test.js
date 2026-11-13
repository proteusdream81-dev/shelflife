
import test from "node:test";
import { createHmac, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { buildMigrationPlan, summarizeMigrationPlan, deriveBase44FirestoreUid, buildBase44IdentityMappings } from "./plan.js";

const exportedAt = "2026-11-10T00:00:00.000Z";

function baseSnapshot(overrides = {}) {
  const empty = {
    AccountDeletionRequest: [],
    Block: [],
    Book: [],
    BookGroup: [],
    BookSearchCache: [],
    ClubSearchCache: [],
    Comment: [],
    Follow: [],
    GroupInvite: [],
    PlacesCache: [],
    RateLimitHit: [],
    ReaderSearch: [],
    ReleaseReminder: [],
    Report: [],
    Shelf: [],
    User: [],
    Waitlist: [],
    WaitlistAttempt: [],
  };
  return {
    metadata: { snapshotId: "snapshot-test-01", exportedAt, consistent: true, ...(overrides.metadata || {}) },
    entities: { ...empty, ...(overrides.entities || {}) },
    ...(overrides.actorMessages ? { actorMessages: overrides.actorMessages } : {}),
  };
}

const identityMappings = [
  {
    base44UserId: "legacy-a",
    firebaseUid: "firebase-a",
    status: "verified",
    proofMethod: "dual-session",
    verifiedAt: exportedAt,
    verifiedBy: "operator@example.test",
  },
  {
    base44UserId: "legacy-b",
    firebaseUid: "firebase-b",
    status: "verified",
    proofMethod: "operator-verified",
    verifiedAt: exportedAt,
    verifiedBy: "operator@example.test",
  },
];

test("requires a consistent, identified source snapshot and all source entity arrays", () => {
  assert.throws(() => buildMigrationPlan({ snapshot: {}, identityMappings }), /snapshotId/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot({ entities: { Book: undefined } }),
    identityMappings,
  }), /Snapshot entity array missing/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [],
  }), /identity mapping/);
});

test("refuses email-only, unverified, non-unique, or unproven identity mappings", () => {
  const invalid = { base44UserId: "legacy-a", firebaseUid: "firebase-a", status: "verified" };
  assert.throws(() => buildMigrationPlan({ snapshot: baseSnapshot(), identityMappings: [invalid] }), /independent proof/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [identityMappings[0], { ...identityMappings[0], base44UserId: "legacy-c" }],
  }), /one-to-one/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [{ ...identityMappings[0], status: "pending" }],
  }), /independent proof/);
});

test("plans identity links at the resolver's top-level path with its exact field contract", () => {
  const plan = buildMigrationPlan({ snapshot: baseSnapshot(), identityMappings });
  const link = plan.documents.find((item) => item.entity === "IdentityLink" && item.sourceId === "legacy-a");
  assert.equal(link.path, "identityLinks/firebase-a");
  assert.deepEqual(link.data, {
    base44UserId: "legacy-a",
    status: "verified",
    proofMethod: "dual-session",
    verifiedAt: exportedAt,
    verifiedBy: "operator@example.test",
    sourceSnapshotId: "snapshot-test-01",
  });
  const reverse = plan.documents.find((item) => item.entity === "LegacyIdentityLink" && item.sourceId === "firebase-a");
  assert.equal(reverse.path, "legacyIdentityLinks/legacy-a");
  assert.deepEqual(reverse.data, {
    firebaseUid: "firebase-a",
    status: "verified",
    proofMethod: "dual-session",
    verifiedAt: exportedAt,
    verifiedBy: "operator@example.test",
    sourceSnapshotId: "snapshot-test-01",
  });
  assert.equal(plan.documents.some((item) => item.path === "migration/identityLinks/firebase-a"), false);
});

test("maps a User profile without email or privileged role", () => {
  const snapshot = baseSnapshot({
    entities: {
      User: [{
        id: "legacy-a",
        email: "reader@example.test",
        full_name: "Reader A",
        username: "reader-a",
        role: "admin",
        profile_hidden: true,
        hide_covers: true,
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const user = plan.documents.find((item) => item.entity === "User");
  assert.equal(user.path, "users/firebase-a");
  assert.equal(user.data.username, "reader-a");
  assert.equal(user.data.profileHidden, true);
  assert.deepEqual(user.data.nameSearchTokens, ["re", "ea", "ad", "de", "er", "r ", " a"]);
  assert.equal("email" in user.data, false);
  assert.equal("role" in user.data, false);
});

test("preserves multi-shelf membership and verifies each shelf belongs to the same mapped user", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [
        { id: "shelf-1", created_by_id: "legacy-a", name: "A" },
        { id: "shelf-2", created_by_id: "legacy-a", name: "B" },
      ],
      Book: [{
        id: "book-1",
        created_by_id: "legacy-a",
        shelf_id: "shelf-1",
        shelf_ids: ["shelf-2", "shelf-1"],
        share_token: "raw-secret",
        share_enabled: true,
        created_date: "2026-11-01T00:00:00.000Z",
        updated_date: "2026-11-02T00:00:00.000Z",
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const book = plan.documents.find((item) => item.entity === "Book");
  assert.deepEqual(book.data.shelfIds, ["shelf-1", "shelf-2"]);
  assert.equal(book.data.createdAt, "2026-11-01T00:00:00.000Z");
  assert.equal(book.data.updatedAt, "2026-11-02T00:00:00.000Z");
  assert.equal("shelf_ids" in book.data, false);
  assert.equal(plan.documents.some((item) => item.path.startsWith("shareLinks/")), true);
  assert.equal(plan.documents.some((item) => JSON.stringify(item.data).includes("raw-secret")), false);
  assert.equal(plan.quarantined.length, 0);
});

test("quarantines a Book with a missing or other-user shelf reference", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [{ id: "shelf-2", created_by_id: "legacy-b", name: "B" }],
      Book: [{
        id: "book-1", created_by_id: "legacy-a",
        shelf_ids: ["shelf-2"],
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Book"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "missing-or-cross-owner-shelf-reference"), true);
});

test("converts selected-share recipients to Firebase UIDs and fails closed for missing mappings", () => {
  const snapshot = baseSnapshot({
    entities: {
      Book: [{
        id: "book-1", created_by_id: "legacy-a",
        shared_with_ids: ["legacy-b", "legacy-missing"],
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const book = plan.documents.find((item) => item.entity === "Book");
  assert.equal(book, undefined);
  assert.equal(plan.quarantined.some((item) => item.reason === "unmapped-selected-share-recipient"), true);
});

test("maps legacy follows without status to accepted and hashes deterministic relationship IDs", () => {
  const snapshot = baseSnapshot({
    entities: {
      Follow: [{ id: "follow-1", follower_id: "legacy-a", following_id: "legacy-b" }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const follow = plan.documents.find((item) => item.entity === "Follow");
  assert.equal(follow.data.status, "accepted");
  assert.match(follow.path, /^relationships\/[a-f0-9]{64}$/);
});

test("quarantines explicit unsupported follow statuses instead of migrating them as accepted", () => {
  const snapshot = baseSnapshot({
    entities: {
      Follow: [{ id: "follow-unknown", follower_id: "legacy-a", following_id: "legacy-b", status: "rejected" }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Follow"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "unsupported-follow-status"), true);
});

test("quarantines self-relations, self-invites and unsupported explicit invite states", () => {
  const snapshot = baseSnapshot({
    entities: {
      BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }],
      Follow: [{ id: "follow-self", follower_id: "legacy-a", following_id: "legacy-a" }],
      Block: [{ id: "block-self", blocker_id: "legacy-a", blocked_id: "legacy-a" }],
      GroupInvite: [
        { id: "invite-self", group_id: "group-1", inviter_id: "legacy-a", invitee_id: "legacy-a" },
        { id: "invite-invalid-status", group_id: "group-1", inviter_id: "legacy-a", invitee_id: "legacy-b", status: "revoked" },
      ],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => ["Follow", "Block", "GroupInvite"].includes(item.entity) &&
    ["follow-self", "block-self", "invite-self", "invite-invalid-status"].includes(item.sourceId)), false);
  assert.ok(plan.quarantined.some((item) => item.reason === "self-follow-relationship"));
  assert.ok(plan.quarantined.some((item) => item.reason === "self-block-relationship"));
  assert.ok(plan.quarantined.some((item) => item.reason === "self-group-invitation"));
  assert.ok(plan.quarantined.some((item) => item.reason === "unsupported-group-invite-status"));
});

test("converts group rosters and removed members to separate membership collections", () => {
  const snapshot = baseSnapshot({
    entities: {
      BookGroup: [{
        id: "group-1", created_by_id: "legacy-a",
        member_ids: ["legacy-a", "legacy-b"], blocked_ids: ["legacy-b"],
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.path === "groups/group-1/members/firebase-b"), true);
  assert.equal(plan.documents.some((item) => item.path === "groups/group-1/removed/firebase-b"), true);
});

test("marks Calendar reminders for reconciliation and hashes share and confirmation tokens", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [{
        id: "shelf-1", created_by_id: "legacy-a",
        share_token: "raw-share-token", share_enabled: true,
      }],
      Book: [{ id: "book-1", created_by_id: "legacy-a", title: "Example" }],
      ReleaseReminder: [{
        id: "reminder-1", created_by_id: "legacy-a",
        book_id: "book-1", event_id: "calendar-event-1",
      }],
      Waitlist: [{
        id: "wait-1", email: "READER@example.test",
        confirm_token: "raw-confirm-token", confirmed: false,
      }],
    },
  });
  const waitlistEmailKey = "test-only-32-byte-secret-key-value";
  const plan = buildMigrationPlan({ snapshot, identityMappings, waitlistEmailKey });
  const link = plan.documents.find((item) => item.entity === "ShareLink");
  const reminder = plan.documents.find((item) => item.entity === "ReleaseReminder");
  const waitlist = plan.documents.find((item) => item.entity === "Waitlist");
  const expectedEmailHash = createHmac("sha256", waitlistEmailKey).update("reader@example.test").digest("hex");
  assert.equal(waitlist.path, `waitlist/${expectedEmailHash}`);
  assert.equal(link.path.length, "shareLinks/".length + 64);
  assert.equal(reminder.data.syncStatus, "needs-reconciliation");
  assert.equal(reminder.data.calendarEventId, "calendar-event-1");
  assert.match(waitlist.data.confirmationTokenHash, /^[a-f0-9]{64}$/);
  assert.equal("confirm_token" in waitlist.data, false);
  assert.equal(JSON.stringify(plan.documents).includes("raw-share-token"), false);
  assert.equal(JSON.stringify(plan.documents).includes("raw-confirm-token"), false);
});

test("counts skipped operational caches and never claims that actor history was captured", () => {
  const snapshot = baseSnapshot({
    entities: {
      RateLimitHit: [{ id: "rate-1" }],
      BookSearchCache: [{ id: "cache-1" }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const summary = summarizeMigrationPlan(plan);
  assert.equal(summary.skippedSourceRecords, 3);
  assert.equal(summary.writesPerformed, 0);
  assert.equal(plan.skipped.some((item) => item.entity === "BookGroupRoom.actorMessages"), true);
});

test("includes explicit actor message export when supplied", () => {
  const snapshot = baseSnapshot({
    entities: {
      User: [{ id: "legacy-a" }, { id: "legacy-b" }],
      BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }],
    },
    metadata: {
      actorHistoryExport: {
        complete: true,
        writeQuiesced: true,
        retentionLimitPerRoom: 300,
        messageCount: 1,
        enumeratedGroupIds: ["group-1"],
        exportedAt,
        exportedBy: "operator@example.test",
        exporterVersion: "1.0.0",
      },
    },
    actorMessages: [{
      id: "message-1", group_id: "group-1",
      author_id: "legacy-b", body: "Hello", at: Date.parse(exportedAt),
    }],
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const message = plan.documents.find((item) => item.entity === "GroupMessage");
  assert.equal(message.path, "groups/group-1/messages/message-1");
  assert.equal(message.data.authorUid, "firebase-b");
  assert.equal(summarizeMigrationPlan(plan).readyForRehearsal, false);
  assert.ok(summarizeMigrationPlan(plan).readinessBlockers.includes("actor-history-export-missing"));
});



test("does not treat an actor message array as a complete export without an attestation", () => {
  const snapshot = baseSnapshot({
    entities: { User: [{ id: "legacy-a" }], BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }] },
    actorMessages: [{ id: "message-1", group_id: "group-1", author_id: "legacy-a", body: "Hello", at: exportedAt }],
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const summary = summarizeMigrationPlan(plan);
  assert.equal(plan.documents.some((item) => item.entity === "GroupMessage"), false);
  assert.equal(plan.skipped.some((item) => item.reason === "actor-export-attestation-missing-or-incomplete"), true);
  assert.equal(summary.readinessBlockers.includes("actor-history-export-missing"), true);
  assert.equal(summary.readyForRehearsal, false);
});

test("requires quiescence, accurate message count and complete group enumeration", () => {
  const actorMessages = [{ id: "message-1", group_id: "group-1", author_id: "legacy-a", body: "Hello", at: exportedAt }];
  const baseAttestation = {
    complete: true, writeQuiesced: true, retentionLimitPerRoom: 300, messageCount: 1,
    enumeratedGroupIds: ["group-1"], exportedAt, exportedBy: "operator@example.test", exporterVersion: "1.0.0",
  };
  for (const actorHistoryExport of [
    { ...baseAttestation, writeQuiesced: false },
    { ...baseAttestation, messageCount: 0 },
    { ...baseAttestation, enumeratedGroupIds: [] },
    { ...baseAttestation, enumeratedGroupIds: ["group-1", "unexported-group"] },
  ]) {
    const snapshot = baseSnapshot({
      entities: { User: [{ id: "legacy-a" }], BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }] },
      metadata: { actorHistoryExport },
      actorMessages,
    });
    const summary = summarizeMigrationPlan(buildMigrationPlan({ snapshot, identityMappings }));
    assert.equal(summary.readyForRehearsal, false);
    assert.equal(summary.readinessBlockers.includes("actor-history-export-missing"), true);
  }
});

test("quarantines messages beyond the 300-message per-room retention limit", () => {
  const actorMessages = Array.from({ length: 301 }, (_, index) => ({
    id: `message-${index + 1}`,
    group_id: "group-1",
    author_id: "legacy-a",
    body: `Message ${index + 1}`,
    at: exportedAt,
  }));
  const snapshot = baseSnapshot({
    entities: { User: [{ id: "legacy-a" }], BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }] },
    metadata: {
      actorHistoryExport: {
        complete: true, writeQuiesced: true, retentionLimitPerRoom: 300, messageCount: 301,
        enumeratedGroupIds: ["group-1"], exportedAt, exportedBy: "operator@example.test", exporterVersion: "1.0.0",
      },
    },
    actorMessages,
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const summary = summarizeMigrationPlan(plan);
  assert.equal(plan.documents.filter((item) => item.entity === "GroupMessage").length, 300);
  assert.equal(plan.quarantined.filter((item) => item.reason === "room-message-retention-limit-exceeded").length, 1);
  assert.equal(summary.readinessBlockers.includes("quarantined-records"), true);
  assert.equal(summary.readyForRehearsal, false);
});

test("quarantines actor messages with invalid timestamps instead of aborting the migration plan", () => {
  const snapshot = baseSnapshot({
    entities: { User: [{ id: "legacy-a" }], BookGroup: [{ id: "group-1", created_by_id: "legacy-a" }] },
    metadata: {
      actorHistoryExport: {
        complete: true, writeQuiesced: true, retentionLimitPerRoom: 300, messageCount: 1,
        enumeratedGroupIds: ["group-1"], exportedAt, exportedBy: "operator@example.test", exporterVersion: "1.0.0",
      },
    },
    actorMessages: [{ id: "message-1", group_id: "group-1", author_id: "legacy-a", body: "Hello", at: "not-a-date" }],
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "GroupMessage"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "invalid-message-timestamp"), true);
});

test("summaries never include document payloads or user data", () => {
  const snapshot = baseSnapshot({
    entities: { Book: [{ id: "book-1", created_by_id: "legacy-a", title: "Private title" }] },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const summary = summarizeMigrationPlan(plan);
  assert.equal(JSON.stringify(summary).includes("Private title"), false);
  assert.equal(summary.writesPerformed, 0);
});

test("quarantines comments whose target record does not belong to the declared owner", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [{ id: "shelf-1", created_by_id: "legacy-b" }],
      Comment: [{
        id: "comment-1", target_kind: "shelf", target_id: "shelf-1",
        owner_id: "legacy-a", author_id: "legacy-b", body: "hello",
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Comment"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "unmapped-comment-party-invalid-target-or-parent-reference"), true);
});

test("quarantines reports if the reported comment is absent or author attribution differs", () => {
  const snapshot = baseSnapshot({
    entities: {
      Report: [{
        id: "report-1", comment_id: "comment-gone",
        author_id: "legacy-a", reporter_id: "legacy-b",
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Report"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "missing-or-inconsistent-reported-comment"), true);
});

test("blocks rehearsal when source User records and identity mappings do not match", () => {
  const snapshot = baseSnapshot({
    entities: { User: [{ id: "legacy-a" }] },
    actorMessages: [],
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  const summary = summarizeMigrationPlan(plan);
  assert.equal(summary.readyForRehearsal, false);
  assert.ok(summary.readinessBlockers.includes("identity-manifest-does-not-match-source-users"));
});

test("quarantines comments with a parent outside the same target thread", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [{ id: "shelf-1", created_by_id: "legacy-a" }],
      Comment: [{
        id: "parent-1", target_kind: "shelf", target_id: "shelf-1",
        owner_id: "legacy-a", author_id: "legacy-a", body: "parent",
      }, {
        id: "child-1", target_kind: "shelf", target_id: "shelf-1",
        owner_id: "legacy-a", author_id: "legacy-b", parent_id: "missing-parent", body: "child",
      }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Comment" && item.sourceId === "child-1"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "unmapped-comment-party-invalid-target-or-parent-reference"), true);
});

test("quarantines waitlist records when the operator HMAC key is missing or too short", () => {
  const snapshot = baseSnapshot({
    entities: { Waitlist: [{ id: "wait-1", email: "reader@example.test" }] },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Waitlist"), false);
  assert.equal(plan.quarantined.some((item) => item.reason === "waitlist-email-hmac-key-required"), true);
});

test("rejects legacy IDs and Firebase UIDs outside the runtime resolver's 1-128 character bounds", () => {
  const tooLong = "x".repeat(129);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [{ ...identityMappings[0], firebaseUid: tooLong }],
  }), /1 to 128 characters/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [{ ...identityMappings[0], base44UserId: tooLong }],
  }), /1 to 128 characters/);
  assert.throws(() => buildMigrationPlan({
    snapshot: baseSnapshot(),
    identityMappings: [{ ...identityMappings[0], firebaseUid: "bad/uid" }],
  }), /1 to 128 characters/);
});


test("quarantines unsupported explicit share audiences instead of widening them to circle", () => {
  const snapshot = baseSnapshot({
    entities: {
      Shelf: [{ id: "shelf-invalid-audience", created_by_id: "legacy-a", share_enabled: true, share_audience: "everyone" }],
      Book: [{ id: "book-invalid-audience", created_by_id: "legacy-a", share_enabled: true, share_audience: "friends" }],
    },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings });
  assert.equal(plan.documents.some((item) => item.entity === "Shelf" && item.sourceId === "shelf-invalid-audience"), false);
  assert.equal(plan.documents.some((item) => item.entity === "Book" && item.sourceId === "book-invalid-audience"), false);
  assert.equal(plan.quarantined.filter((item) => item.reason === "unsupported-share-audience").length, 2);
});

test("derives stable Base44 principals and emits source-snapshot mappings", () => {
  const users = [{ id: "legacy-a" }, { id: "legacy-b" }];
  const metadata = { snapshotId: "snapshot-base44-01", exportedAt: exportedAt };
  const mappings = buildBase44IdentityMappings(users, metadata);
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].firestoreUid, deriveBase44FirestoreUid("legacy-a"));
  assert.equal(mappings[0].firestoreUid, deriveBase44FirestoreUid("legacy-a"));
  assert.match(mappings[0].firestoreUid, /^b44_[a-f0-9]{64}$/);
  assert.equal(mappings[0].authProvider, "base44");
  assert.equal(mappings[0].proofMethod, "deterministic-base44-principal");
  assert.equal(mappings[0].verifiedBy, "migration-planner");
});

test("rejects incomplete, duplicate, or malformed Base44 source users", () => {
  assert.throws(() => buildBase44IdentityMappings([], { snapshotId: "s", exportedAt }), /non-empty/);
  assert.throws(() => buildBase44IdentityMappings([{ id: "x" }], { snapshotId: "", exportedAt }), /snapshot ID/);
  assert.throws(() => buildBase44IdentityMappings([{ id: "x" }, { id: "x" }], { snapshotId: "s", exportedAt }), /unique/);
  assert.throws(() => buildBase44IdentityMappings([{ id: "bad/id" }], { snapshotId: "s", exportedAt }), /valid Base44 IDs/);
});

test("plans reciprocal Base44 principal links and profiles using deterministic UIDs", () => {
  const mappings = buildBase44IdentityMappings([{ id: "legacy-a" }, { id: "legacy-b" }], {
    snapshotId: "snapshot-base44-01",
    exportedAt,
  });
  const snapshot = baseSnapshot({
    metadata: { snapshotId: "snapshot-base44-01" },
    entities: { User: [{ id: "legacy-a", full_name: "Reader A" }, { id: "legacy-b", full_name: "Reader B" }] },
  });
  const plan = buildMigrationPlan({ snapshot, identityMappings: mappings });
  const uid = deriveBase44FirestoreUid("legacy-a");
  const forward = plan.documents.find((item) => item.path === `identityLinks/${uid}`);
  const reverse = plan.documents.find((item) => item.path === "legacyIdentityLinks/legacy-a");
  const profile = plan.documents.find((item) => item.path === `users/${uid}`);
  assert.equal(forward.data.authProvider, "base44");
  assert.equal(reverse.data.firestoreUid, uid);
  assert.equal(reverse.data.authProvider, "base44");
  assert.equal(profile.data.displayName, "Reader A");
  assert.equal(summarizeMigrationPlan(plan).readyForRehearsal, true);
});
