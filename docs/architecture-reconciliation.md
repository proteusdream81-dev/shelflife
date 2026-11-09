# ShelfLife architecture reconciliation

**Status:** Proposed target architecture and migration control record  
**Reviewed:** 10 November 2026  
**Scope:** Reconcile the current Base44-backed application, the Firebase/Vercel Preview migration work, and the CodeLustre Google infrastructure direction.  
**Decision boundary:** This document does not authorize a Production cutover, PR merge, data import, or deletion of legacy data.

## 1. Executive decision

Google Cloud and Firebase are the strategic infrastructure direction. That direction is not evidence that the application has already migrated. The checked repository still contains an active Base44 SDK dependency and the current `src/lib/AuthContext.jsx` authenticates through Base44. Firebase Auth and Firestore currently appear in isolated Preview migration code, not as a complete app-wide replacement.

Adopt the following target, subject to the open decisions in section 8:

- Keep the React/Vite client and Vercel deployment while migration proceeds. Do not replace Vercel hosting with Firebase Hosting without a separate cost/operations decision.
- Use Firebase Authentication for new sign-in and session identity, with verified email and supported sign-in methods configured in the Firebase project.
- Keep privileged data access behind Vercel server/API handlers using keyless Vercel OIDC to Google Workload Identity Federation (WIF). No service-account JSON keys.
- Use Cloud Firestore as the application database, with deny-by-default client rules and explicit server-side authorization for privileged operations.
- Keep Base44 as the legacy source and rollback reference until data, feature parity, account mapping, and acceptance gates pass.
- Defer Firebase Storage until file/image ownership, access policy, expected volume, and Blaze-plan cost have been assessed.

## 2. Verified current state

| Area | Verified state | Interpretation |
|---|---|---|
| Client | React/Vite app; Base44 SDK remains in dependencies | Not a Firebase-only client yet |
| Current auth | `src/lib/AuthContext.jsx` calls Base44 app settings and `base44.auth.me()` | Existing app-wide auth still Base44 |
| Hosting | Vercel project and Preview deployments are configured | Keep Vercel during migration |
| Firebase project | `shelflife-tbr-9754d` | Project exists; this alone does not prove production readiness |
| Preview identity | Vercel OIDC -> Google WIF service account | Keyless Preview path exists |
| Preview Firestore | PR #21 adds a REST adapter and read-only owner-scoped endpoint | Preview-only; depends on explicit identity link and IAM |
| Firestore client rules | Deny-all in the migration design | Appropriate while all access is server mediated |
| Legacy source | Base44 app still contains entity schemas and server functions | Do not disable until migration acceptance |
| Data migration | Not performed | Existing Base44 records are not yet reconciled in Firestore |
| Production cutover | Not verified or authorized | No Production change is implied by open PRs |

## 3. Pull request reconciliation

| PR | Purpose | Disposition |
|---|---|---|
| #13 | Migration foundation and staged direction | Retain as historical design context; check whether its decisions are superseded by later Preview implementation |
| #17 | Firebase readiness and rules/Storage notes | Retain as readiness reference; validate against actual current cloud configuration |
| #18 | Firebase Auth Preview smoke-test route | Useful isolated validation; not an app-wide auth replacement |
| #19 | Revocation-aware Firebase token verification | Security prerequisite for trusted Preview APIs |
| #20 | UID-path owner-scoped books read | Overlaps with #21's owner-scoped read approach; do not merge independently |
| #21 | Explicit Firebase UID -> Base44 ID mapping and allowlisted owner-only reads | Current broader Preview foundation; still draft and not a production migration |

PR #20 and #21 represent competing first data-access patterns: #20 assumes a future `users/{firebaseUid}/books` hierarchy; #21 reads legacy-shaped top-level entity collections using an explicit UID-to-Base44-user mapping and `created_by_id` filters. Do not merge both. The canonical schema in this document must be decided before either endpoint becomes a permanent app contract. Keep #20 open for reference until the chosen approach is implemented and verified; do not close it automatically.

## 4. Proposed Firestore domain model

This is a proposed normalized target, not an assertion that these collections already exist.

| Firestore path | Source concept | Access model / notes |
|---|---|---|
| `users/{uid}` | Firebase user profile and app preferences | Private to the user; public profile fields exposed only through a controlled API |
| `users/{uid}/books/{bookId}` | Base44 Book | Owner-private by default; preserve source IDs during migration where safe; retain shelf memberships, status, notes, review, rating, formats, series, content warnings and enrichment metadata |
| `users/{uid}/shelves/{shelfId}` | Base44 Shelf | Owner-private by default; preserve `is_private`, description and membership references |
| `users/{uid}/releaseReminders/{reminderId}` | Base44 ReleaseReminder | Owner-only; retain book reference, date and external Calendar event ID; sync through server only |
| `groups/{groupId}` | Base44 BookGroup | Public/private visibility; owner UID and metadata; membership/invite state must be separate and enforceable |
| `groups/{groupId}/members/{uid}` | BookGroup.member_ids | Membership document created only by owner invite acceptance or public join; removal/block state must be enforced |
| `groups/{groupId}/invites/{inviteId}` | GroupInvite | Invitee-only read/accept/decline; owner-only create/revoke; idempotent status transitions |
| `relationships/{relationshipId}` | Follow | Directional follower/following UIDs; pending/accepted state; both sides' permissions tested |
| `blocks/{blockId}` | Block | Blocker and blocked UIDs; enforced in both directions across search, follow, invites, group rooms, shared shelves and comments |
| `comments/{commentId}` and `commentReports/{reportId}` | Comments / reports | Server-mediated; access derived from the shared item and block graph; report moderation data private |
| `identityLinks/{firebaseUid}` | Migration-only Firebase UID -> legacy Base44 ID | Server-only; no client reads/writes; explicit operator verification; remove or archive after migration reconciliation policy is settled |

### Data modelling rules

1. Use Firebase UID as the canonical identity in the target system. Keep the legacy Base44 ID only in a migration mapping or audit field until reconciliation is complete.
2. Preserve original Base44 document IDs where practical so references, exports and rollback comparisons remain deterministic.
3. Avoid copying large arrays of member IDs as the only source of truth. Use membership/invite documents for bounded, queryable and auditable access decisions.
4. Keep private user content (notes, ratings, reviews, reading activity, private shelves) separate from public profile and shared projections.
5. Never return share tokens, email addresses, private notes, ratings, or private member lists in public projections.
6. Store share-token hashes, not raw bearer tokens, in the target. A token is a bearer credential; rotate/revoke it and rate-limit lookup endpoints.
7. Preserve multi-shelf book membership. The source model has both `shelf_id` and `shelf_ids`; import and acceptance tests must not collapse one into the other.
8. Use server timestamps and explicit schema versions; validate payloads at API boundaries.
9. Use deterministic IDs or migration source IDs to make import idempotent and to support count/reference reconciliation.

## 5. Authorization matrix

| Capability | Owner | Accepted circle follower | Selected recipient | Public/anonymous | Group member |
|---|---:|---:|---:|---:|---:|
| Read private book/shelf | Yes | No | Only if explicitly shared | No | No, unless separately shared |
| Read circle-shared book/shelf | Yes | Yes, if not blocked and profile/share conditions pass | Only if explicitly selected | No | No, unless separately shared |
| Read selected-share item | Yes | No unless selected | Yes, if not blocked | No | No, unless separately shared |
| Read bearer-link projection | Yes | N/A | N/A | Yes, while enabled and token valid | N/A |
| Read public BookGroup metadata | Yes | Yes | Yes | Only if signed-in/public policy explicitly allows | Yes |
| Read private BookGroup room | Yes | No | No | No | Yes |
| Invite/remove group members | Owner only | No | No | No | No |
| Accept/decline own invite | N/A | Invitee only | Invitee only | No | N/A |
| Read/write comments | Owner plus eligible share viewers | If eligible | If eligible | Only if share-link policy allows | Only under group/thread policy |

All rows above are proposed policy. The existing Base44 implementation contains more nuanced rules: hidden profiles, accepted versus pending follows, blocks in either direction, selected-recipient shares, public/private clubs, invite acceptance, and comments scoped to a shared item. These must be ported as server-side policy tests, not simplified to owner-only access at cutover.

## 6. Legacy backend behavior inventory (repository scan)

The default-branch repository scan found 18 Base44 server function entry points. The table below records their observed responsibilities from source comments and implementation. This is a function inventory, not yet a complete inventory of every entity, workflow, agent, connector, scheduled trigger or external side effect.

| Legacy function/helper | Observed responsibilities | Migration requirement |
|---|---|---|
| `searchBooks` | Search book catalogues, retry transient failures, cache results and rate-limit use | Preserve provider fallback, cache semantics, retry policy and quota controls |
| `bookCovers` | Look up alternate edition covers | Preserve ISBN/title/provider matching and limits |
| `bookSeries` | Resolve series membership and volume order | Preserve matching accuracy and null-result handling |
| `bookFormats` | Look up and cache available editions/formats | Port shared cache and rate limits |
| `enrichBooks` | Enrich imported reader books from catalogue data; batch and validate title/author matches | Preserve user-entered fields, matching safeguards and partial outcomes |
| `authorReleases` | Build release calendar from authors found in a reader's library | Preserve date-window logic, author deduplication and catalogue failure handling |
| `weeklyTrending` | Workflow/admin weekly genre scan; compares against owned/seen titles and caches seen items | Port scheduled trigger, admin-only auth, genre selection and dedupe state |
| `nearbyPlaces` | Search nearby libraries/bookshops via Photon and Overpass with retry/fallback/cache | Preserve geospatial provider fallback, request budget and rate limits |
| `discoverBookClubs` | Discover external book clubs by category and location; cache public listings | Preserve source attribution, categories and external links |
| `readingCircle` | Reader lookup; follow requests/responses; unfollow/remove follower; block/unblock; usernames; hidden profiles; rate limits; shared shelf counts | Port identity privacy, directional relationship states, block enforcement and anti-enumeration limits |
| `bookGroups` | Public/private groups; join/leave; invite/accept/decline; member removal; owner close; max 50 members; block checks and rate limits | Use transactional membership/invite state; test invite races, owner removal and group closure |
| `comments` | Shared item discussion, comment/report handling, email notifications; access via shared-item policy and blocks | Port item-derived authorization, report privacy, body limits, moderation and notification behavior |
| `getSharedShelf` / `sharedAccess` | Anonymous bearer-link read; safe public projection; hidden covers; circle/selected share access; blocks | Hash tokens; keep strict field projections; rate-limit anonymous lookups; test revoke/rotate |
| `releaseReminders` | Sync Want-to-Read future release dates to each reader's Google Calendar; create/update/delete events and persist event IDs | Rebuild with per-user OAuth connection, idempotent event sync and cleanup; do not lose external Calendar side effects |
| `accountDeletion` / `accountWipe` | Email verification code flow; deletes user-owned content and references from relationships/invites/groups; removes user account | Implement full export/delete workflow and audit external side effects. Review whether ReleaseReminder records and Google Calendar events are cleaned up; current inspected `accountWipe` helper does not visibly include them |
| `joinWaitlist` | Public beta waitlist signup and confirmation email flow, abuse limits and resend throttling | Preserve consent, confirmation, enumeration resistance, mail delivery and retention policy |
| `confirmWaitlistTester` | Confirm tester invitation and show beta/Play onboarding page | Port token validation, one-time use and tester lifecycle |
| `testerOutageNotice` | Admin-only bulk tester outage email; supports dry run and batches recipients | Replace with tightly authorized admin workflow, preview recipient count, audit trail and mail limits |

Supporting helpers include `bookSearch`, `sharedAccess`, `blocks`, `rateLimit`, `requireUser`, `errors` and `accountWipe`. Supporting entities referenced by these flows include `GroupInvite`, `ReaderSearch`, `BookSearchCache`, comments/reports, waitlist/tester records and account-deletion request records. The six-collection Preview allowlist in PR #21 is not a complete application data inventory.


| Legacy function/helper | Observed responsibilities | Migration requirement |
|---|---|---|
| `readingCircle` | Reader lookup; follow requests and responses; unfollow/remove follower; block/unblock; usernames; profile-hidden handling; rate limits; shared shelf counts | Port identity privacy, directional relationship states, block enforcement and anti-enumeration limits |
| `bookGroups` | Public/private groups; join/leave; invite/accept/decline; member removal; owner close; max 50 members; block checks and rate limits | Use transactional membership/invite state; test invite races, owner removal and group closure |
| `comments` | Shared item discussion, comment/report handling, email notifications; access via shared-item policy and blocks | Port item-derived authorization, report privacy, body limits, moderation and notification behavior |
| `getSharedShelf` / `sharedAccess` | Anonymous bearer-link read; safe public projection; hidden covers; circle/selected share access; blocks | Hash tokens; keep strict field projections; rate-limit anonymous lookups; test revoke/rotate |
| `releaseReminders` | Sync Want-to-Read future release dates to each reader's Google Calendar; create/update/delete events and persist event IDs | Rebuild with per-user OAuth connection, idempotent event sync and cleanup; do not lose external Calendar side effects |
| `accountDeletion` / `accountWipe` | Email verification code flow; deletes user-owned content and references from relationships/invites/groups; removes user account | Implement full export/delete workflow and audit external side effects. Review whether ReleaseReminder records and Google Calendar events are cleaned up; current inspected `accountWipe` helper does not visibly include them |
| `joinWaitlist` | Registration waitlist capture | Decide whether still needed; apply consent, retention and abuse controls |

Other supporting entities referenced by these flows include `GroupInvite`, `ReaderSearch`, comments/reports, and account-deletion request records. The six-collection Preview allowlist in PR #21 is not a complete application data inventory.

## 7. Migration plan and acceptance gates

### Gate 0 — Architecture baseline
- [x] Separate strategic Google/Firebase direction from actual migration completion.
- [x] Identify overlap between PR #20 and #21.
- [x] Record source entity and business-rule requirements.
- [ ] Confirm the proposed Firestore schema and authorization matrix.
- [ ] Complete a full inventory of Base44 entities, functions, integrations, scheduled work and external side effects.

### Gate 1 — Identity and Preview
- [ ] Confirm Firebase Auth methods, email verification, password reset and account recovery.
- [ ] Independently verify the exact Firebase UID ↔ Base44 user mapping for each test account.
- [ ] Confirm Preview WIF subject restrictions, IAM permissions and audit logging.
- [ ] Remove broad project-level IAM grants where possible; prefer a custom least-privilege role.
- [ ] Test expired/revoked/disabled Firebase sessions and unlinked identities.
- [ ] Keep client Firestore rules deny-all while access is server mediated.

### Gate 2 — Feature parity and security
- [ ] Implement the approved canonical schema and server API.
- [ ] Test two-account isolation for every collection and API.
- [ ] Test hidden profiles, pending/accepted follows, blocks in both directions, selected shares, public links, token revocation, group invites, group removal and comments.
- [ ] Test account deletion and cleanup of external Calendar events.
- [ ] Add Firestore Emulator tests for security rules and server authorization.
- [ ] Add audit logs for sensitive actions without logging tokens or private content.

### Gate 3 — Data migration rehearsal
- [ ] Export a consistent Base44 snapshot and retain a protected backup.
- [ ] Build a dry-run importer with explicit entity allowlist and source-to-target mapping.
- [ ] Use deterministic IDs and create-only/idempotent writes; no overwrite by default.
- [ ] Reconcile per-entity counts, owner counts, references, multi-shelf memberships and orphaned records.
- [ ] Run functional and permission tests against imported staging data.
- [ ] Record rollback steps and prove Base44 remains usable during rehearsal.

### Gate 4 — Cutover (separate approval required)
- [ ] Obtain explicit approval for the exact cutover window and rollback threshold.
- [ ] Freeze or dual-write source changes only after a tested strategy is chosen.
- [ ] Complete final delta sync and reconciliation.
- [ ] Switch app auth/data API in a controlled release.
- [ ] Monitor errors, latency, auth failures, billing and support feedback.
- [ ] Retain Base44 source and backups until the agreed rollback window expires.

## 8. Unresolved decisions / blockers

1. **Canonical data shape:** choose whether to migrate directly to per-user subcollections or use a staged compatibility layer. PR #20 and #21 currently disagree.
2. **Identity proof:** the existing UID-to-Base44 mapping must be independently confirmed; matching email is only a consistency check.
3. **Complete source inventory:** identify all entities and all server functions, agents, automations, integrations and scheduled jobs before schema freeze.
4. **Sharing policy:** decide the exact target policy for circle shares, selected recipients, anonymous links, hidden profiles, group visibility and comments.
5. **Account deletion:** confirm whether calendar events and reminder records are removed, and define the target deletion request/verification process.
6. **Firebase rules and IAM:** PR #21 documents project-level `roles/datastore.user`; that is broader than the intended least-privilege posture. Verify actual current grants and replace with a custom minimal role before production.
7. **Storage:** decide whether images remain external URLs or move to Firebase Storage; quantify storage/egress and Blaze billing implications first.
8. **Hosting:** Vercel remains the current deployment direction; Firebase Hosting is not approved as a replacement.
9. **Google Play:** confirm current tester cohort, release track, crash/ANR evidence and release gates before any public rollout.

## 9. Immediate next actions

1. Keep PR #21 as the only active owner-data Preview implementation candidate pending schema decision.
2. Do not merge PR #20 independently; retain it as a reference for the alternative UID-path pattern.
3. Complete the full Base44 entity/function/integration inventory and map each to the target model.
4. Confirm the identity mapping and least-privilege Preview IAM with a controlled two-account test.
5. Finalize the schema and authorization tests before any import code or production cutover.

## 10. Current safety status

- No Base44 data import is recorded.
- No Firestore writes or client rule relaxation are authorized by this document.
- No Production auth, hosting, IAM or data cutover is authorized.
- PRs #20 and #21 remain draft and unmerged.
