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
| `users/{uid}` | Base44 User profile + Firebase identity | Firebase UID is document ID. Store display name, username, profile visibility, cover/content-warning preferences, storefront and tester preferences. Never copy email or credentials into public profile fields. Role is server-managed (for example, Firebase custom claims). |
| `users/{uid}/books/{bookId}` | Base44 Book | Preserve source document ID where safe; title/author/edition metadata, ISBN/ASIN, `cover_url`, optional owner-only `cover_storage_key` for private R2 objects, `alt_covers`, catalogue IDs, categories, buy links, status, format(s), series, content warnings, enrichment metadata, both `spice` and `spice_rating` legacy fields, and normalized multi-shelf membership. Keep notes/reviews/ratings private to the owner projection. |
| `users/{uid}/shelves/{shelfId}` | Base44 Shelf | Preserve name, description and is_private; share policy stored here or as referenced share-link metadata. |
| `users/{uid}/releaseReminders/{reminderId}` | Base44 ReleaseReminder | Preserve reminder record ID, book reference, title, author, release date and external Google Calendar event ID. Import as `needs-reconciliation`; do not create, move or delete Calendar events until the corresponding reader OAuth connection is checked. Server-only writes. |
| `groups/{groupId}` | Base44 BookGroup | ownerUid, name, book_title, description, category, location, meets, isPrivate, createdAt/updatedAt. Do not make member arrays the sole authority. |
| `groups/{groupId}/members/{uid}` | Group roster | One document per member; role/status/joinedAt. Include the owner as role `owner`; membership is granted only by a successful public join or invite acceptance. |
| `groups/{groupId}/removed/{uid}` | Base44 BookGroup `blocked_ids` | Group-local removal/tombstone. It is not a global user Block. Prevents a removed reader rejoining until the owner invites them again. |\n| `groups/{groupId}/invites/{inviteId}` | Base44 GroupInvite | inviterUid, inviteeUid, status (pending/accepted/declined/revoked), timestamps. Invitee can answer only their own invite; owner can create/revoke. |
| `groups/{groupId}/messages/{messageId}` | BookGroupRoom actor history | authorUid, displayName snapshot, body (max 1,000 chars to preserve actor behavior), createdAt. Retain bounded history/retention. |
| `relationships/{relationshipHash}` | Base44 Follow | Directional Firebase UIDs, pending/accepted status, createdAt/updatedAt. `relationshipHash` is SHA-256 of `followerUid + NUL + followingUid` to avoid delimiter collisions. Legacy rows with no status mean accepted. |
| `blocks/{blockHash}` | Base44 Block | Directional blockerUid/blockedUid and createdAt. `blockHash` is SHA-256 of `blockerUid + NUL + blockedUid`. Every share, follow, invite, group, library and comment check must honour blocks in either direction. |
| `comments/{commentId}` | Base44 Comment | targetKind (book/shelf), targetId, ownerUid, authorUid, body (max 2,000 chars), optional parentId, createdAt. All access derived from target visibility. |
| `moderationReports/{reportId}` | Base44 Report | commentId, targetKind/targetId, authorUid, reporterUid, reason, excerpt, createdAt, moderation state. Admin/moderator only. |
| `usernameReservations/{normalizedUsername}` | Unique username index | uid, createdAt. Created/updated transactionally with the user's profile. Server-only exact username lookup reads this index rather than scanning profiles. Exact email lookup resolves through Firebase Auth Admin using verified email and never adds email to public profile documents or search responses. |
| `shareLinks/{tokenHash}` | Base44 Book/Shelf `share_token` | ownerUid, targetKind, targetId, enabled, createdAt, revokedAt. `tokenHash` is SHA-256 of the existing raw bearer token. Never import, log, return or store the raw token in Firestore. |
| `waitlist/{emailHmac}` | Base44 Waitlist | HMAC-SHA-256 of normalized email as document ID using a secret stored in Secret Manager; restricted server-only email field (email delivery still requires the address), name, source, founding-tester consent, confirmed, confirmationTokenHash, resend counters/timestamps. A plain SHA-256 email hash is not acceptable. Never include waitlist email in public user/profile APIs. |
| `accountDeletionRequests/{requestId}` | Base44 AccountDeletionRequest | Only if a separate short-lived deletion challenge must survive a staged operation: normalized email protected from client access, codeHash, expiresAt, attempts and consumedAt; TTL cleanup. Current source count is zero; never migrate an unexpired request without completing it in Base44 first. Never store the raw six-digit code. |
| `privateCaches/bookSearch/{cacheKey}` | Base44 BookSearchCache | Catalogue results/formats, fetchedAt, expiresAt. No reader data. Server-only. |
| `privateCaches/clubSearch/{cacheKey}` | Base44 ClubSearchCache | Public directory results, fetchedAt, expiresAt. Server-only. |
| `privateCaches/places/{cacheKey}` | Base44 PlacesCache | OpenStreetMap place results, fetchedAt, expiresAt. Server-only. |
| `opsRateLimits/{bucketKey}` | RateLimitHit, ReaderSearch, WaitlistAttempt | One document per SHA-256(actor UID + bucket), containing bucket, actorHash, bounded sliding-window timestamp array, updatedAt, expiresAt (Firestore Timestamp, 24-hour retention) and schemaVersion. Updates use Firestore updateTime compare-and-set; server-only. Never store raw UIDs, IPs or email addresses in keys. Firestore TTL on expiresAt must be provisioned and verified before enabling the limiter. |
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


## 6. Account deletion and retention parity

The checked-in Base44 `wipeAccount` helper currently removes the user's Books, Shelves, BookGroups, Follow/Block edges, GroupInvites and ReaderSearch records, pulls them from other groups' member lists, and deletes the User record last. It does not visibly remove `ReleaseReminder` records or their external Google Calendar events, Comments where the user is author or target owner, Reports where the user is reporter/author, or deletion-request records in the signed-in deletion path. The helper also does not explicitly clear the corresponding `BookGroupRoom` actor storage after a group is deleted.

Treat these as known parity gaps, not proof that the external records currently exist. Before replacing Base44 deletion:
- delete/anonymize owned profile, book, shelf, reminder, relationship, block, invite, group, comment and operational records according to retention policy;
- remove the user from other group rosters and write a group-local removed marker where required;
- attempt per-reader Calendar event deletion only with a valid OAuth grant; record failed cleanup for a retry/manual resolution and do not report full deletion while required cleanup is outstanding;
- clear actor message history and disconnect presence for deleted groups;
- preserve moderation evidence only under an explicit retention policy, with personal identifiers minimized;
- ensure signed-in and email-code deletion paths have the same deletion semantics;
- delete or expire email-code requests after use, and never transfer unexpired requests into the new identity store.

## 7. Authorization and operational controls

- Keep direct client Firestore access denied during the first migration stages.
- All privileged API routes verify Firebase ID token signature, issuer, audience, expiry, disabled-user state and revocation status.
- The owner UID comes only from the verified token, never from request parameters.
- Use keyless Vercel OIDC → Google WIF and a dedicated Preview service account. Do not create service-account key files.
- Replace broad `roles/datastore.user` if still present with a project-specific custom role containing only the required Firestore read/write permissions. Verify the live grant before changing it; do not apply IAM changes from a stale assumption.
- Use transactions for invite acceptance, username reservation, relationship changes, share token rotation and idempotent migration markers.
- Server-side API logs may include request IDs, route, status and latency; they must not contain access tokens, raw share tokens, email addresses or private book content.
- Add Firestore Emulator tests for rules and server policy. Two-account tests are mandatory for all ownership and sharing paths.

## 8. Import contract

- Default mode is dry-run. There is no write mode by default.
- Read a consistent protected Base44 export/snapshot; record its ID and timestamp.
- Import only an explicit allowlist. Exclude ephemeral cache and rate-limit history by default.
- Preserve deterministic document IDs and source IDs in a migration-only field.
- Create-only/idempotent semantics. An existing target document is reported as a conflict; never overwrite by default. Deterministic relationship/block document IDs use SHA-256 over the ordered UID pair with a NUL separator.
- Verify every owner mapping before writing. The verified identity manifest must be one-to-one and cover the exported User set; no email-only owner inference. The dry-run planner quarantines missing/ambiguous mappings and invalid references.
- Reconcile source/target counts, hashes, references, orphaned shelf/book memberships, follows, group rosters, comments, reminders and external Calendar event IDs.
- Keep rejects/quarantine separate. Never silently drop malformed records. Raw Book/Shelf bearer tokens and Waitlist confirmation tokens are SHA-256 hashed; waitlist email identifiers use HMAC-SHA-256 with a secret key from Secret Manager. Raw tokens are not copied into the target.
- Back up Firestore before any write-enabled rehearsal and prove restore/rollback in a non-production project.
- Never import Production user data through this chat session; use an audited authenticated operator environment with explicit write approval and a run manifest.

## 9. Current source data snapshot (IDs-only audit, 10 November 2026)

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

## 10. External services, agent and scheduled work

- Book catalogue/enrichment: Google Books API, Open Library, Hardcover GraphQL API, Project Gutenberg/Gutendex; covers from Open Library/Google Books. Amazon and Bookfinder are outgoing purchase/search links, not write integrations.
- Nearby places: Photon geocoder and OpenStreetMap Overpass endpoints.
- Release reminders: per-reader Google Calendar events. Current app-level Google Workspace connector state was reported expired in the 10 Nov live connector check; user OAuth connections must be individually checked before calendar migration.
- Email: Base44 Core SendEmail is used by waitlist, tester, comment, account-deletion and notification flows. The target mail provider is not yet selected.
- Connectors declared in source: Google Sheets and Instagram. The earlier app connector check reported Google Sheets disconnected and Instagram Business active; these connector states could not be rechecked in the current pass because the Base44 integration workspace is out of credits.
- Other app-level integrations reported by the earlier connector check: Google Search Console, GitHub and Sentry active; Gmail and Google Workspace expired. These are not reverified in this pass and do not prove that every feature actively uses them.
- Base44 agent: `book_club_host`, which reads groups/invites and calls bookGroups, discoverBookClubs and releaseReminders. Port its product behavior to a server-owned agent workflow after the data API is stable; do not make agent access a shortcut around authorization.
- Base44 actor: `BookGroupRoom`, keyed by group ID, holds presence and bounded chat history. Source limits: 40 concurrent readers, up to 120 messages returned in history, 300 messages retained, 1,000-character message body. Rebuild using Firestore durable messages plus Firebase Realtime Database presence only after plan/rules and load tests. Actor storage is outside the 18 entity export and requires its own history export; the dry-run planner blocks rehearsal readiness until that export is explicitly included.
- Recurring workflow: `base44/workflows/WeeklyTrendingMatches.jsonc` invokes `weeklyTrending` every Monday at 08:00 in `Australia/Sydney` (cron `0 8 * * 1`) and sends the WeeklyTrendingMatches email only when `new_count > 0`. Recreate this exact schedule and timezone only after the mail provider, recipient behaviour and idempotency are approved.\n- One-off workflow: `base44/workflows/TesterOutageNotice.jsonc` was scheduled for 25 October 2026 at 13:27 UTC. That date is past; do not recreate it as a future scheduled job.
- Email templates in repository: AccountDeletionCode, ConfirmTesterEmail, EnquiryReply, FoundingTesterWelcome, Newsletter, ProductUpdate, ShelfComment, TesterOutageNotice, WeeklyTrendingMatches and Welcome.
- GitHub Actions repository workflow: one Build validation workflow. The recurring and one-off workflow definitions are in the Base44 repository tree, not GitHub Actions.

## 11. Pull request reconciliation and next implementation sequence

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

## 12. Explicit state

- User approved this Firestore v1 target on 10 November 2026.\n- The checked-in dry-run planner in `scripts/migration/plan.js` builds an in-memory create-only plan; it cannot call Firestore or apply writes. It checks one-to-one independently verified identity links, user coverage, shelf/book references, sharing recipients, group membership/removal, relationships, comments, reports, reminders, hashed tokens and actor-message export. It blocks readiness for incomplete identity coverage, quarantined records or missing actor history.
- No Base44 data has been imported by this work.
- No Firestore client rule relaxation or Production IAM change has been made.
- No Production authentication/hosting/data cutover or public Google Play release is implied.
- PR #20 and #21 remain open and unmerged; PR #22 remains a documentation PR until separately reviewed/merged.


## Custom cover object metadata

- Store the rendered cover URL in `cover_url` and the private R2 object key in `cover_storage_key` on the owning `users/{uid}/books/{bookId}` document.
- The object key is opaque and UID-scoped; it is not a public asset URL and must not be included in public/share projections.
- A Firebase-authenticated server API must verify that the requested book document exists under the UID derived from the token before an object is uploaded or a new read URL is issued.
- The R2 bucket remains private. The Worker returns a time-limited signed read URL for use as `cover_url`; an owner refreshes the URL and persists the updated value when it expires. Never store bucket credentials or raw upload tokens in Firestore.
- When a replacement upload succeeds, persist the new URL/key first; remove the old object only after the metadata update has succeeded. On failure, retain the old cover and clean up the unreferenced new object.
- This is a target data contract. It does not mean the app, Worker, Firestore document writes, or R2 refresh flow are currently deployed.
