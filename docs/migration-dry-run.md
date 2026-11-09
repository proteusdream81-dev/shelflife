# ShelfLife migration dry-run

## Purpose and hard limits

The dry-run planner converts a protected Base44 export and a separately verified identity manifest into an in-memory Firestore v1 document plan.

It is deliberately **not an importer**. It performs no network requests, Firestore writes, updates, deletes, Firebase user creation, linking or changes to Base44. There is no apply mode in this command.

The planner rejects missing/ambiguous identity mappings and source/reference inconsistencies. It never infers identity from email. It blocks readiness if the source snapshot is not explicitly declared consistent, if the exported User set is not exactly covered by the identity manifest, if any record is quarantined, or if the separate group-room actor-history export is missing.

## Inputs

### 1. Protected source snapshot

The JSON snapshot must be created from an authorized, consistent Base44 export. It must not be created by the planner itself.

Required structure:

```json
{
  "metadata": {
    "snapshotId": "source-export-identifier",
    "exportedAt": "2026-11-10T00:00:00.000Z",
    "consistent": true
  },
  "entities": {
    "AccountDeletionRequest": [],
    "Block": [],
    "Book": [],
    "BookGroup": [],
    "BookSearchCache": [],
    "ClubSearchCache": [],
    "Comment": [],
    "Follow": [],
    "GroupInvite": [],
    "PlacesCache": [],
    "RateLimitHit": [],
    "ReaderSearch": [],
    "ReleaseReminder": [],
    "Report": [],
    "Shelf": [],
    "User": [],
    "Waitlist": [],
    "WaitlistAttempt": []
  },
  "actorMessages": []
}
```

The example arrays are placeholders, not an export. A real export must include every source record in all 18 entities. Actor history must be separately exported from each `BookGroupRoom` actor instance and represented as `actorMessages` with `id`, `group_id`, `author_id`, `body` and `at`. Missing actor history blocks the plan.

Treat source exports as sensitive. Store them only in an encrypted, access-controlled operator workspace. Never add source exports, identity manifests, logs or plan payloads to GitHub, Notion, support tickets or this chat. Delete temporary local copies according to the approved retention policy after the audit is complete.

### 2. Independently verified identity manifest

The manifest is a JSON array, one row per Base44 User record:

```json
[
  {
    "base44UserId": "legacy-user-id",
    "firebaseUid": "firebase-auth-uid",
    "status": "verified",
    "proofMethod": "dual-session",
    "verifiedAt": "2026-11-10T00:00:00.000Z",
    "verifiedBy": "operator identity"
  }
]
```

Allowed proof methods are `dual-session` or `operator-verified`. Every row must have a verifier and timestamp. Base44 IDs and Firebase UIDs must form a unique one-to-one mapping. Do not auto-link based on email equality, display name, phone number or any other matching profile field. A test manifest must never be substituted for the real user manifest.

## Run

From a trusted operator environment, with a checked-out copy of this branch:

```bash
npm ci
npm run migration:dry-run -- --help
npm run migration:dry-run -- \
  --snapshot /secure/path/shelflife-source-snapshot.json \
  --identity-map /secure/path/shelflife-verified-identities.json
```

The CLI prints only a redacted count summary and readiness blockers. Exit code 0 means the plan is structurally ready for a separately approved non-production rehearsal. Exit code 2 means quarantine/readiness blockers remain. Exit code 1 means the input or command was invalid.

The in-memory plan contains transformed record payloads; do not log or serialize that object in a shared system. Only call `summarizeMigrationPlan(plan)` when producing an operator-facing summary.

## Transformations and checks

- User documents use Firebase UID paths and omit email and role.
- Books/Shelves use the original source record ID under `users/{uid}` and preserve multi-shelf membership.
- A Book is quarantined if a shelf reference is missing or belongs to another mapped user.
- Selected share recipients must all map to Firebase UIDs. Raw bearer tokens are never copied; share-link document IDs are SHA-256 hashes.
- Follows and Blocks use deterministic SHA-256 document IDs based on the ordered UID pair, separated with a NUL byte. Legacy Follow records without a status become `accepted`.
- Group owners, active members, removed-member tombstones and invites become separate documents; missing users/groups are quarantined.
- Comments must map author and owner, and the target must exist and belong to the declared owner. Reports must point to an exported comment with matching author attribution.
- Release reminders must reference a book belonging to the same mapped owner. Calendar event IDs are retained but reminders are marked `needs-reconciliation`; no Calendar API is called.
- Waitlist email addresses are normalized and used only to derive a hashed document ID; confirmation tokens are hashed before planning.
- Expired/consumed deletion challenges, caches and operational rate-limit history are skipped and counted. Unexpired deletion challenges block readiness and must be handled in the existing Base44 deletion process.
- Actor message history must be separately supplied. Presence is ephemeral and is not migrated.

## What this does not prove

A successful dry-run is not a source backup, export checksum, Firestore write rehearsal, IAM verification, account-link proof beyond the supplied manifest, Firestore emulator authorization test, restore test, application feature-parity test or Production cutover approval.

Before any write-enabled rehearsal, operators must:
1. Create and protect a consistent Base44 source snapshot and verify source counts/checksum manifests.
2. Independently verify every Firebase UID ↔ Base44 User mapping.
3. Verify live Preview IAM and Firestore target counts, including whether target paths are already populated.
4. Back up the non-production Firestore target and test restore/rollback.
5. Review each quarantined record and all selected-share / group / comment / reminder references.
6. Obtain separate approval for a write-enabled non-production rehearsal.

No write-enabled importer is included in this branch.
