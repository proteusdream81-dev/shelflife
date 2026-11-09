# ShelfLife Firestore schema v1

**Decision:** Accepted target architecture  
**Approved:** 10 November 2026  
**Status:** Target contract for implementation. Not a claim that the database has been provisioned or populated.

## 1. Core decisions

1. Firebase Authentication UID is the canonical application identity.
2. User-owned data is stored under `users/{uid}` subcollections. Do not use top-level Base44-style `Book` or `Shelf` collections as the permanent app data model.
3. Shared/community objects that require cross-user discovery live in dedicated top-level collections (`groups`, `relationships`, `blocks`, `comments`).
4. The React/Vite client remains on Vercel. Privileged reads and writes use authenticated server/API endpoints with Firebase ID-token verification and keyless Vercel OIDC → Google Workload Identity Federation.
5. Client Firestore rules remain deny-all while all business permissions are enforced by server APIs. Do not loosen rules to make migration tests pass.
6. Base44 is the legacy source and rollback reference until export, mapping, migration, reconciliation, parity tests and a separately approved cutover are complete.
7. Firebase Storage is deferred. Existing cover assets are URLs; no evidence yet justifies the additional storage/billing surface.
8. PR #20's per-UID books path is directionally consistent with this target but is only a books read slice. PR #21's top-level legacy entity queries are a migration-only compatibility/audit bridge, not the final app data API. Reuse the proven WIF/auth foundation, but consolidate endpoints against this schema.

## 2. Canonical collections

| Path | Source / purpose | Core fields and rules |
|---|---|---|
| `users/{uid}` | Base44 User profile + Firebase identity | Firebase UID is document ID. Store public profile/preferences only: username, profile_hidden, hide_covers, show_content_warnings, storefront, tester preferences. Do not duplicate Firebase password or auth credentials. Role is server-managed. |
| `users/{uid}/books/{bookId}` | Base44 Book | Preserve source document ID where safe; title/author/edition metadata, ISBN/ASIN, covers, catalogue IDs, categories, buy links, status, format(s), series, content warnings, enrichment metadata, `shelf_id` and `shelf_ids`. Keep private notes private. |
| `users/{uid}/shelves/{shelfId}` | Base44 Shelf | Preserve name, description and is_private; share policy stored here or as referenced share-link metadata. |
| `users/{uid}/releaseReminders/{bookId}` | Base44 ReleaseReminder | book reference, title, author, release date, external Google Calendar event ID, sync status and timestamps. Server-only writes. |
| `groups/{groupId}` | Base44 BookGroup | ownerUid, name, book_title, description, category, location, meets, isPrivate, createdAt/updatedAt. Do not make member arrays the sole authority. |
| `groups/{groupId}/members/{uid}` | Group roster | One document per member; role/status/joinedAt. Membership is granted only by a successful public join or invite acceptance. |
| `groups/{groupId}/invites/{inviteId}` | Base44 GroupInvite | inviterUid, inviteeUid, status (pending/accepted/declined/revoked), timestamps. Invitee can answer only their own invite; owner can create/revoke. |
| `groups/{groupId}/messages/{messageId}` | BookGroupRoom actor history | authorUid, displayName snapshot, body (max 1,000 chars to preserve actor behavior), createdAt. Retain bounded history/retention. |
| `relationships/{followerUid}_{followingUid}` | Base44 Follow | Directional IDs, pending/accepted status, createdAt/updatedAt. Deterministic document ID prevents duplicate follow edges. |
| `blocks/{blockerUid}_{blockedUid}` | Base44 Block | Directional blockerUid/blockedUid and createdAt. Every share, follow, invite, group, library and comment check must honour blocks in either direction. |
| `comments/{commentId}` | Base44 Comment | targetKind (book/shelf), targetId, ownerUid, authorUid, body (max 2,000 chars), optional parentId, createdAt. All access derived from target visibility. |
| `moderationReports/{reportId}` | Base44 Report | commentId, targetKind/targetId, authorUid, reporterUid, reason, excerpt, createdAt, moderation state. Admin/moderator only. |
| `usernameReservations/{normalizedUsername}` | Unique username index | uid, createdAt. Created/updated transactionally with the user's profile. |
| `shareLinks/{tokenHash}` | Book/shelf bearer links | ownerUid, targetKind, targetId, enabled, createdAt, revokedAt. Store only a cryptographic hash of the bearer token; never store or expose the raw token in database reads. |
| `waitlist/{emailHash}` | Base44 Waitlist | encrypted/controlled email field, name, source, founding-tester consent, confirmed, confirmationTokenHash, resend counters/timestamps. Server-only. |
| `accountDeletionRequests/{requestId}` | Base44 AccountDeletionRequest | emailHash, codeHash, expiresAt, attempts, consumedAt; TTL cleanup. Never store the raw six-digit code. |
| `privateCaches/bookSearch/{cacheKey}` | Base44 BookSearchCache | Catalogue results/formats, fetchedAt, expiresAt. No reader data. Server-only. |
| `privateCaches/clubSearch/{cacheKey}` | Base44 ClubSearchCache | Public directory results, fetchedAt, expiresAt. Server-only. |
| `privateCaches/places/{cacheKey}` | Base44 PlacesCache | OpenStreetMap place results, fetchedAt, expiresAt. Server-only. |
| `opsRateLimits/{bucketKey}` | RateLimitHit, ReaderSearch, WaitlistAttempt | Aggregated time-window counters, hashed actor keys, expiresAt. Replace one-document-per-hit writes with transactional window counters and TTL. Never store raw IPs or email addresses in keys. |
| `migration/identityLinks/{firebaseUid}` | Temporary migration bridge | base44UserId, status, proofMethod, verifiedAt, verifiedBy, sourceSnapshotId. Server-only and deny-all to clients. Remove/archive after migration audit and rollback window. |
| `migration/runs/{runId}` | Migration audit ledger | source snapshot ID, schemaVersion, startedAt, completedAt, per-entity counts, checksum summaries, errors, operator and run status. Do not store book contents or raw PII in logs. |

### Realtime group presence

Use Firebase Realtime Database for ephemeral presence/connection state only, keyed by group and authenticated UID, with disconnect cleanup. Firestore remains the durable source for group metadata, membership, invites and message history. The current actor limits (40 concurrent readers, history of 120 messages, retention of at most 300 messages) should remain explicit product limits and receive regression tests. RTDB has not been provisioned or approved for billing yet; implement it only after confirming the Firebase plan and rules.

## 3. Source entity mapping

All 18 Base44 entity schemas were retrieved from the connected ShelfLife app on 10 November 2026.

| Base44 entity | Firestore v1 target | Migration treatment |
|---|---|---|
| AccountDeletionRequest | accountDeletionRequests | Keep pending requests only if legally/operationally required; expire old requests; re-check account deletion process. |
| Block | blocks | Convert Base44 user IDs to Firebase UIDs; validate directional edges and both-direction enforcement. |
| Book | users/{uid}/books | Preserve IDs and user-entered values; reconcile all shelf references. |
| BookGroup | groups | Convert owner ID; extract member_ids and blocked_ids to member/block subdocuments. |
| BookSearchCache | privateCaches/bookSearch | Rebuildable cache; migrate only if useful, otherwise expire/omit. |
| ClubSearchCache | privateCaches/clubSearch | Rebuildable cache; migrate only if useful, otherwise expire/omit. |
| Comment | comments | Convert author/owner IDs; preserve parent/thread links and validate target access. |
| Follow | relationships | Convert follower/following IDs and preserve pending/accepted semantics (missing legacy status means accepted). |
| GroupInvite | groups/{groupId}/invites | Convert inviter/invitee IDs and retain state transitions. |
| PlacesCache | privateCaches/places | Rebuildable cache; generally omit and repopulate. |
| RateLimitHit | opsRateLimits | Do not import historical hit rows; begin fresh rate-limit windows. |
| ReaderSearch | opsRateLimits | Do not import raw historical lookup rows; reset counters after migration. |
| ReleaseReminder | users/{uid}/releaseReminders | Preserve Calendar event IDs and reconcile external events before any account cleanup. |
| Report | moderationReports | Preserve active reports and evidence; admin-only. |
| Shelf | users/{uid}/shelves | Preserve IDs, descriptions and privacy/sharing configuration. |
| User | users | Map only after account linking; Firebase Auth remains identity authority. |
| Waitlist | waitlist | Preserve confirmed/consent state and necessary contact fields; hash confirmation tokens. |
| WaitlistAttempt | opsRateLimits | Do not import historical attempt rows; reset counters. |

## 4. Field-level privacy and sharing invariants

- Private book notes never leave the owner account.
- A private shelf is owner-only, regardless of sharing toggles.
- Circle shares require an accepted follow relationship and no block in either direction; pending follows grant no visibility.
- Selected-recipient shares are visible only to the owner and explicitly selected recipients, subject to the block policy.
- A valid enabled share link is a bearer permission for its specific book/shelf only. It does not expose the owner's email, private profile, other shelves, notes, or ratings.
- Public projections are explicit allowlists. Never serialize a raw Book/Shelf/User document as a public response.
- Cover hiding remains enforced in link and circle views.
- User rating/spice data is private unless the product's explicit opt-in field permits that exact projection. Do not infer permission from a general share flag.
- Hidden profiles remain undiscoverable through reader search and circle browsing, except for explicitly selected sharing where current Base44 behavior permits it.
- Group invite acceptance is the permission to join a private group. Public group join is a separate explicit action. Owner removal blocks re-entry until re-invited.
- A block in either direction suppresses follow, share, invitations, discovery and comment access where the current Base44 behavior requires it.
- Comment visibility is inherited from the target book/shelf. Comment create/remove/report remains authenticated and rate-limited; anonymous share-link access is read-only.
- Reports and account deletion requests are private operational records.

## 5. Identity migration contract

The live Base44 app currently has 21 User records. The live record scan found 3,224 Book records owned by 9 distinct Base44 IDs and 52 Shelf records owned by 17 distinct Base44 IDs. The schema therefore needs account mapping across a multi-user population; a one-user mapping is not an adequate migration.

Identity mapping rules:

1. Firebase UID is the canonical target key.
2. Base44 IDs are legacy identifiers only. Store them only in a restricted migration map / audit manifest until source reconciliation is signed off.
3. Never auto-link by matching email alone.
4. A future self-service link flow should require proof of control of both the existing Base44 session and the new Firebase session, with a short-lived one-time challenge and server-side verification. If this is not practical, use an independently verified operator-assisted process for each source user.
5. A mapping record must be unique, immutable after verification except through an audited admin repair, and rejected if either side is already linked elsewhere.
6. Validate ownership for every source record before writing it to a target user's subcollection. Missing, ambiguous or unlinked owners go to a quarantine report, not a guessed account.

## 6. Authorization and operational controls

- Keep direct client Firestore access denied during the first migration stages.
- All privileged API routes verify Firebase ID token signature, issuer, audience, expiry, disabled-user state and revocation status.
- The owner UID comes only from the verified token, never from request parameters.
- Use keyless Vercel OIDC → Google WIF and a dedicated Preview service account. Do not create service-account key files.
- Replace broad `roles/datastore.user` if still present with a project-specific custom role containing only the required Firestore read/write permissions. Verify the live grant before changing it; do not apply IAM changes from a stale assumption.
- Use transactions for invite acceptance, username reservation, relationship changes, share token rotation and idempotent migration markers.
- Server-side API logs may include request IDs, route, status and latency; they must not contain access tokens, raw share tokens, email addresses or private book content.
- Add Firestore Emulator tests for rules and server policy. Two-account tests are mandatory for all ownership and sharing paths.

## 7. Import contract

- Default mode is dry-run. There is no write mode by default.
- Read a consistent protected Base44 export/snapshot; record its ID and timestamp.
- Import only an explicit allowlist. Exclude ephemeral cache and rate-limit history by default.
- Preserve deterministic document IDs and source IDs in a migration-only field.
- Create-only/idempotent semantics. An existing target document is reported as a conflict; never overwrite by default.
- Verify every owner mapping before writing. No email-only owner inference.
- Reconcile source/target counts, hashes, references, orphaned shelf/book memberships, follows, group rosters, comments, reminders and external Calendar event IDs.
- Keep rejects/quarantine separate. Never silently drop malformed records.
- Back up Firestore before any write-enabled rehearsal and prove restore/rollback in a non-production project.
- Never import Production user data through this chat session; use an audited authenticated operator environment with explicit write approval and a run manifest.

## 8. Current source data snapshot (IDs-only audit, 10 November 2026)

Read-only Base44 queries selected only record IDs and, for ownership summaries, legacy owner IDs. No titles, notes, emails, ratings, or other private content were retrieved for this count.

| Base44 entity | Records |
|---|---:|
| AccountDeletionRequest | 0 |
| Block | 0 |
| Book | 3,224 |
| BookGroup | 2 |
| BookSearchCache | 976 |
| ClubSearchCache | 7 |
| Comment | 5 |
| Follow | 11 |
| GroupInvite | 0 |
| PlacesCache | 7 |
| RateLimitHit | 311 |
| ReaderSearch | 26 |
| ReleaseReminder | 3 |
| Report | 0 |
| Shelf | 52 |
| User | 21 |
| Waitlist | 2 |
| WaitlistAttempt | 6 |
| **Total** | **4,653** |

This is a paginated, non-transactional operational count and may move as the app remains live. It is not a backup, export, checksum or migration snapshot. Counts from earlier notes that stated one Book and one Shelf are superseded by this live audit. Owner summary: 9 distinct legacy owners for Books, 17 for Shelves, 2 for ReleaseReminders, 1 for BookGroups, 5 follower IDs and 2 comment authors. Counts do not prove corresponding Firebase mappings exist.

The previous migration review recorded zero documents in the six proposed Firestore source collections, but that Firestore check was not repeated during the current Base44 audit. Treat Firestore target population as unverified until a fresh authenticated count-only check is performed.

## 9. External services, agent and scheduled work

- Book catalogue/enrichment: Google Books API, Open Library, Hardcover GraphQL API, Project Gutenberg/Gutendex; covers from Open Library/Google Books. Amazon and Bookfinder are outgoing purchase/search links, not write integrations.
- Nearby places: Photon geocoder and OpenStreetMap Overpass endpoints.
- Release reminders: per-reader Google Calendar events. Current app-level Google Workspace connector state was reported expired in the 10 Nov live connector check; user OAuth connections must be individually checked before calendar migration.
- Email: Base44 Core SendEmail is used by waitlist, tester, comment, account-deletion and notification flows. The target mail provider is not yet selected.
- Connectors declared in source: Google Sheets and Instagram. Live app connector check reported Google Sheets disconnected and Instagram Business active.
- Other connected app-level integrations observed: Google Search Console active, GitHub active, Sentry active; Gmail and Google Workspace expired. These are current Base44 connection statuses, not evidence that every feature uses them.
- Base44 agent: `book_club_host`, which reads groups/invites and calls bookGroups, discoverBookClubs and releaseReminders. Port its product behavior to a server-owned agent workflow after the data API is stable; do not make agent access a shortcut around authorization.
- Base44 actor: `BookGroupRoom`, keyed by group ID, holds presence and bounded chat history. Rebuild using Firestore durable messages plus Firebase Realtime Database presence after plan/rules and load tests.
- Scheduled/automated behavior: `weeklyTrending` is described in code as a Monday admin/workflow scan and emails a digest. No scheduler definition was found in the repository tree; inspect the Base44 workflow configuration and recreate it with Cloud Scheduler only after identifying its active schedule and recipients.
- Email templates in repository: AccountDeletionCode, ConfirmTesterEmail, EnquiryReply, FoundingTesterWelcome, Newsletter, ProductUpdate, ShelfComment, TesterOutageNotice, WeeklyTrendingMatches and Welcome.
- GitHub Actions repository workflow: one Build validation workflow; no scheduled workflow was found in the inspected repository tree.

## 10. Pull request reconciliation and next implementation sequence

| PR | Decision |
|---|---|
| #13 | Historical migration foundation; retain for context. |
| #17 | Firebase readiness/rules/Storage reference; revalidate against actual cloud configuration. |
| #18 | Firebase Auth Preview smoke test; useful isolated check, not app-wide auth cutover. |
| #19 | Revocation-aware Firebase token verification; retain as shared security foundation. |
| #20 | Per-UID books read path matches the chosen target direction but is only an early books endpoint. Do not merge independently; consolidate with shared WIF/auth code and expand under schema v1. |
| #21 | Explicit UID-to-Base44 identity mapping and top-level owner-filtered legacy reads. Keep as a Preview-only migration audit bridge, not the final app collection layout. The documented broad Datastore User IAM grant must be live-verified and reduced before Production use. |
| #22 | This architecture/schema decision and source inventory. Documentation only; does not itself migrate or modify data. |

Implementation order:
1. Finalize shared Firebase/WIF auth and one normalized `users/{uid}/books` API using the approved path.
2. Add shelves and multi-shelf reference support; then groups, relationships, blocks, sharing links and comments.
3. Add dual-session account linking and two-account authorization tests.
4. Port all 18 backend functions, the group actor, book-club host agent, integrations and weekly automation by feature.
5. Build a dry-run export/import/reconciliation utility, then perform a non-production rehearsal with a protected source snapshot and Firestore backup.
6. Only after full feature parity, security review, cost review and rollback rehearsal should a separate Production cutover proposal be presented.

## 11. Explicit state

- User approved this Firestore v1 target on 10 November 2026.
- No Base44 data has been imported by this work.
- No Firestore client rule relaxation or Production IAM change has been made.
- No Production authentication/hosting/data cutover or public Google Play release is implied.
- PR #20 and #21 remain open and unmerged; PR #22 remains a documentation PR until separately reviewed/merged.
