# ShelfLife Firebase data model and security-rules design

## Status and safety boundary

This is a proposed target design for review and implementation on the migration branch. It is **not deployed** and does not create or modify Firebase resources. Base44 remains the active backend.

The design assumes Firebase Authentication for identity, Firestore as the proposed primary document store, Vercel server functions using the Firebase Admin SDK for trusted application operations, and Firebase Storage remaining separate for existing book-cover uploads. This provider choice is a proposed architecture, not proof that the Firebase products are enabled or that the owner has approved a production cutover.

The companion `firestore.rules` is deliberately fail-closed: it denies all direct Firestore client reads and writes. This is intentional while the client still uses Base44 and before the replacement API is complete. Firebase Admin SDK calls from Vercel bypass Firestore Security Rules, so every server endpoint must independently verify the Firebase ID token and enforce the authorization policy described here.

**Do not deploy these rules as a production change.** They are a safe starter for a future isolated Firebase staging project after the server API and tests exist. They do not alter Firebase Storage rules.

## Identity and ownership

- Firebase Authentication UID is the canonical identity for new accounts.
- Store application profile documents at `users/{uid}`. The document ID must equal the verified Firebase UID.
- During migration, maintain a protected mapping from the legacy Base44 user ID to Firebase UID. Do not assume the IDs match. Keep the mapping server-only and use it only during the controlled migration period.
- Every user-owned record has immutable `ownerId` equal to the Firebase UID. Never accept `ownerId`, `createdById`, role, or actor identity from an untrusted request body.
- Admin privileges must come from a server-controlled custom claim or a protected server-only role registry. A profile field editable by the user is not authority.
- Use server timestamps for created/updated metadata. Keep legacy Base44 timestamps and IDs in explicit migration metadata where reconciliation requires them.

## Proposed collection layout

Use top-level collections for entities that need cross-user queries, moderation, or server-side workflows. Keep private per-user data nested where it naturally belongs. These paths are a target design; preserve legacy IDs as document IDs where practical to simplify reconciliation.

| Collection / path | Document identity and key fields | Access policy |
|---|---|---|
| `users/{uid}` | Profile, lowercase username, role display, profileHidden, hideCovers, showContentWarnings, storefront, tester preferences | Owner can read; profile discovery uses a server projection that excludes private fields. Only server may set role/admin metadata and unique username claims. |
| `users/{uid}/shelves/{shelfId}` | name, description, isPrivate, shareEnabled, shareToken, shareAudience, sharedWithIds | Owner-only canonical record. Shared views are server-projected and token/recipient checked. |
| `users/{uid}/books/{bookId}` | Catalogue metadata plus owner-specific status, notes, review, rating, formats, series, content warnings and share controls | Owner-only canonical record. A shared book projection exposes only fields allowed by its share settings. |
| `bookGroups/{groupId}` | ownerId, name, bookTitle, category, location, meets, isPrivate, memberIds, blockedIds | Public summary may be discoverable; private details restricted to owner/members. Membership and owner-removal changes are server-only transactions. |
| `groupInvites/{inviteId}` | groupId, inviterId, inviteeId, status, timestamps | Only inviter/invitee may receive a minimal projection; create/accept/decline are server-validated transitions. |
| `follows/{followId}` | followerId, followingId, status, timestamps | Server-only writes; reads through privacy/block-aware API. Deterministic pair ID prevents duplicate follow edges. Legacy missing status maps to accepted. |
| `blocks/{blockId}` | blockerId, blockedId, createdAt | Server-only writes; server enforces block in both directions across all social features. Deterministic pair ID. |
| `comments/{commentId}` | authorId, target type/id, body, createdAt, moderation state | Server-only writes; reads only after target visibility and block checks. |
| `reports/{reportId}` | reporterId, target type/id, reason, status, createdAt | Server-only; never publicly queryable. |
| `releaseReminders/{reminderId}` | ownerId, bookId, title, author, releaseDate, calendarEventId | Owner-scoped API only. Calendar OAuth tokens live in a separate server-only secret store, never in this document. |
| `accountDeletionRequests/{requestId}` | emailNormalized, codeHash, expiresAt, attempts, used, ownerId, createdAt | Server-only. Never store the raw confirmation code; apply expiry, attempt cap and one-use semantics transactionally. |
| `waitlist/{entryId}` | normalized email, confirmation state/token hash, tester state, createdAt | Server-only guest workflow; never expose the full waitlist to clients. |
| `waitlistAttempts/{attemptId}` | hashed visitor/email keys, timestamp, outcome | Server-only rate-limit/audit data. |
| `rateLimitHits/{hitId}` | hashed subject, operation, window, timestamp/expiry | Server-only; use atomic counters/transactions or a dedicated rate-limit store for concurrency safety. |
| `bookSearchCache/{cacheId}`, `clubSearchCache/{cacheId}`, `placesCache/{cacheId}` | normalized cache key, payload, expiresAt, provider metadata | Server-only; expire with TTL plus explicit stale-cache logic. |
| `readerSearch/{uid}` | normalized searchable fields and visibility flags | Server-maintained projection only; exclude hidden profiles and blocked relationships at query/projection time. |

## Books and shelves

The legacy `Book` entity mixes catalogue metadata and user-specific state. The proposed nested `users/{uid}/books` model keeps notes, reviews, ratings, reading status and sharing preferences private to the owner by default. If catalogue deduplication is required, introduce a separate server-maintained `catalogueBooks/{catalogueId}` collection and reference it from user book records; do not let a shared catalogue record become a back door to another user's private annotations.

Preserve multi-shelf membership (`shelfIds`, including legacy `shelf_id` during import compatibility), statuses `to_read`, `reading`, `read`, supported formats and series fields, content-warning and spice visibility preferences, and per-book share settings. Preserve custom cover URL behaviour without broadening Storage permissions.

Never return an entire Book or Shelf document to an anonymous share visitor. Build an explicit allowlisted response projection after validating token, audience, expiry/revocation, owner visibility, and block rules.

## Required invariants and transactions

1. **Username uniqueness:** normalize to lowercase; claim through a transaction on `usernames/{username}`. Release the old claim and claim the new one atomically. Validate syntax and reserved names server-side.
2. **Share-token uniqueness:** generate high-entropy random tokens; claim in a dedicated `shareTokens/{token}` mapping transactionally. Revoke by deleting/invalidating the mapping. Never use guessable sequential IDs.
3. **Follow uniqueness:** deterministic key from follower UID + following UID; enforce pending/accepted state transitions in a transaction. Treat imported legacy rows with absent status as accepted.
4. **Block semantics:** store directional edges but evaluate both directions for visibility, follows, invites, comments, discovery and group access. A block must also neutralize existing relationships as current behaviour requires.
5. **Group membership:** owner, invitee, member and blocked checks happen on the server. Acceptance changes invite state and membership atomically. Owner removal immediately denies future chat posts and room access.
6. **Account deletion:** use a resumable server job with progress checkpoints. Delete or anonymize all owned and inbound references, including books/shelves, social edges, invites, comments/reports as policy requires, reminders, search projections and group membership references. Make retries idempotent; do not assume one Firestore batch can process an unbounded account.
7. **Guest endpoints:** waitlist and shared-shelf token routes remain rate-limited and validate token hashes/expiry. Anonymous users never receive collection-level access.
8. **Realtime group chat:** choose a separate authenticated realtime transport. Re-check group membership and owner-removal state at connection and privileged actions; bind author ID to verified identity; enforce the existing 40-reader, 120-history, 300-retained-message and 1,000-character limits unless product-approved changes are made.

## Security-rules posture

The initial Firestore client rules should remain deny-all. This is compatible with the migration phase because the existing app continues to use Base44 and the proposed Vercel API will use Admin SDK. Do not open client reads/writes just to make a prototype work.

If direct client access is ever introduced, add narrowly scoped rules only after tests prove that they cannot bypass owner-only canonical shelf/book access, hidden-profile and selected-share restrictions, both-direction block enforcement, group owner/member/invite state, trusted admin operations, and private deletion/report/cache/waitlist/rate-limit records.

Firestore rules cannot safely replace every multi-document business invariant or complex query-time privacy check. Keep privileged transitions and public share projections in server endpoints.

## Index and query plan (provisional)

Create composite indexes only from observed production query patterns and emulator failures. Likely candidates to validate:
- `users/{uid}/books`: `status + updatedAt`, `shelfIds array-contains + status`, `author + publishedDate` where used.
- `users/{uid}/shelves`: `updatedAt` or explicit display order.
- `bookGroups`: `isPrivate + category + location`, and public discovery sort fields.
- `groupInvites`: `inviteeId + status + createdAt`; `inviterId + status + createdAt`.
- `releaseReminders`: `ownerId + releaseDate`.
- `comments`: `targetType + targetId + createdAt`.
- `waitlist`: normalized email lookup must be unique via deterministic email-hash document, not a non-unique query.
- Cache collections: deterministic cache document IDs; expiry field for TTL.

These are hypotheses, not deploy-ready index declarations. Capture actual query shapes from frontend call sites and handler source before generating `firestore.indexes.json`.

## Migration and validation sequence

1. Create a separate Firebase staging project or isolated non-production database only after explicit approval; enable Auth/Firestore there, not in production.
2. Implement token verification, repository layer and deny-all rules in Vercel preview. Use Firebase Emulator Suite for rules and repository tests.
3. Test anonymous, owner, selected-share recipient, circle follower, unrelated signed-in reader, blocked reader, removed group member and trusted admin.
4. Export Base44 data read-only. Build a legacy-ID-to-Firebase-UID map, preserve legacy IDs, and import into staging only.
5. Compare per-collection counts, owner counts, references, unique constraints, orphan records, share tokens and checksums. Re-run import to prove idempotency.
6. Run web and existing Android internal-test client compatibility checks against staging without changing the published artifact or its API origin.
7. Keep Base44 available for rollback. Production migration, rules deployment, client cutover and any new Play build require separate explicit approval.

## Open decisions before implementation

- Confirm Firebase Auth providers and whether existing Base44 users can be migrated without forcing password resets; passwords cannot be exported as plaintext.
- Confirm whether Firestore is the approved primary database, not just the current Storage configuration.
- Choose the group-chat realtime transport.
- Inspect every entity schema and handler query before finalizing collection paths and indexes.
- Define retention policy for reports, deletion audit records, waitlist data and analytics.
- Confirm the actual Base44 export format and stable user-ID mapping.
