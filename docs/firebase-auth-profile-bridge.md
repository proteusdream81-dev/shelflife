# Firebase Authentication to ShelfLife profile bridge

## Status

Design and implementation contract only. This document does not enable Firebase products, create Firestore resources, migrate accounts, or change the live login flow. Base44 remains the active identity and profile system.

The Firebase client adapter and `POST /api/auth/session` token-verification probe exist. PR #28 adds a guarded `GET /api/me` resolver on branch `migration/firebase-profile-bridge`: it requires a verified Firebase token, a server-side verified `identityLinks/{firebaseUid}` record containing `base44UserId`, and an existing `users/{uid}` profile. The response projection now matches the normalized profile schema (`displayName`, `username`, `profileHidden`, `hideCovers`, `showContentWarnings`, `storefront`, `foundingTesterOptedIn`, `testerPromptDismissed`) and excludes role and migration metadata. The route is not wired into the login UI and is not deployed. Do not treat a valid Firebase token as proof that a matching Base44 account has been migrated.

## Non-negotiable identity rules

1. Firebase UID is the future canonical authentication subject. A Base44 user ID is a separate legacy identifier; never assume they are equal.
2. Never automatically link accounts by matching email alone. Email may be unverified, changed, shared, or duplicated in legacy data.
3. Never let the browser choose or submit a trusted `legacyBase44UserId`, `ownerId`, role, or admin flag as authority.
4. A link between an existing Base44 account and a Firebase UID must be established by a trusted server operation that verifies both identities during a controlled transition.
5. Linking is one-to-one unless a deliberate, audited account-merge workflow is designed and approved. Reject collisions; do not silently overwrite mappings.
6. Do not create a blank profile for an existing reader merely because they signed in with Firebase. That can strand their books, shelves, groups, and social graph under the legacy ID.
7. Do not migrate passwords. Base44 password hashes are not assumed portable. Existing readers may need a verified account-recovery or password-reset path after cutover.

## Proposed server-only mapping

Use the protected top-level Firestore document `identityLinks/{firebaseUid}`. Its canonical fields are:

- `base44UserId`: exact legacy Base44 user ID (the resolver reads this field)
- `status`: `verified` only after independent proof is reviewed
- `proofMethod`: `dual-session` or `operator-verified`
- `verifiedAt`: ISO timestamp of the verification decision
- `verifiedBy`: accountable verifier identifier
- `sourceSnapshotId`: optional source snapshot reference

The Firebase UID is the document ID. The migration planner and `GET /api/me` must use this same top-level path and field spelling. Do not use `migration/identityLinks` or `legacyBase44UserId`; those do not match the resolver contract. Enforce one-to-one uniqueness in the validated identity manifest before planning documents. A reverse-claim collection may be added only with a transaction-capable writer and matching resolver checks; the current REST adapter is not transaction-capable. Keep identity links inaccessible to browser clients.

Do not store access tokens, refresh tokens, passwords, OTP codes, or service-account credentials in these documents.

## Linking flow for an existing signed-in reader

The safe interactive linking flow requires all of the following:

1. The reader is currently authenticated to the existing Base44 account.
2. The server independently verifies the active Base44 session and resolves its authoritative Base44 user ID. It must not trust an ID in the request body.
3. The reader completes Firebase sign-in and obtains a fresh Firebase ID token. Require a recent Firebase `auth_time` (re-authentication if stale).
4. The browser sends the Firebase ID token to a dedicated linking endpoint while the existing Base44 session is also present.
5. The server verifies both credentials, checks the Base44 account is eligible, checks for existing conflicting links, and transactionally claims both directions.
6. The response returns only a minimal account-link status. It must not return private profile or library data.
7. On subsequent requests, the Firebase UID resolves to the legacy profile/data owner through the server-side mapping until the data migration is complete.

The current repository does not demonstrate server-side Base44 session verification from Vercel. Therefore the current safe route is an audited, read-only export/import identity manifest: each row must include the exact `base44UserId`, exact Firebase UID independently established outside email matching, `status: "verified"`, `proofMethod: "operator-verified"`, `verifiedAt`, and `verifiedBy`. The planner rejects missing proof metadata, duplicate legacy IDs, duplicate Firebase UIDs, and incomplete coverage of source User records. It emits only dry-run document plans; it does not create links or write to Firestore. Never manufacture the manifest from matching email addresses.

## New-account flow

A genuinely new Firebase account may receive a new ShelfLife profile only after the product owner approves the new account policy and the profile repository exists. The server should:

- require verified email where the product's policy requires it;
- create the profile idempotently at `users/{firebaseUid}`;
- set identity and role fields server-side;
- create a new internal profile ID only if required by the data model;
- never attach a legacy Base44 library based only on email equality;
- preserve registration consent, waitlist, age gate, and analytics semantics.

The existing registration flow also performs Base44 OTP verification, waitlist enrollment, and registration analytics. Replacing it requires an explicit parity plan for each behaviour; Firebase email verification is not automatically equivalent to the existing six-digit Base44 OTP UI.

## Required API contract before wiring the UI

| Endpoint | Purpose | Required checks |
|---|---|---|
| `POST /api/auth/session` | Verify Firebase identity (current probe) | Firebase JWT signature, issuer, audience, expiry and subject. This endpoint does not authorize data access. |
| `POST /api/auth/link` | Link a currently signed-in Base44 account to Firebase UID | Independently verify both sessions, recent re-authentication, eligibility, collision checks, atomic bidirectional claim, audit record. |
| `GET /api/me` | Resolve the authenticated ShelfLife profile | Verify Firebase token, resolve server-only mapping, return a minimal profile projection. No client-selected owner ID. |
| `POST /api/auth/unlink` | Exceptional recovery only, if approved | Strong re-authentication, audit, collision/recovery safeguards. Do not expose as a routine client action. |

Every data endpoint must use the same verified identity resolver and then enforce feature-specific authorization. A successful `/api/auth/session` response alone must never grant access to books, shelves, comments, groups, or shared links.

## UI integration gates

Only wire Firebase sign-in/register screens after all gates pass:

- [ ] Firebase Auth providers and authorized domains are configured for the intended Preview host.
- [ ] Firestore or the approved identity store is enabled in an isolated non-production environment.
- [ ] Firebase Admin SDK is available to Vercel through an approved workload identity or server-only secret mechanism; no private key is placed in Vite variables or Git.
- [ ] Base44 session verification is proven from Vercel, or a reviewed import mapping is available.
- [ ] Link and profile-resolution endpoints are implemented and tested.
- [ ] Existing Base44 users can sign in, link, reload, and see the same profile and library.
- [ ] New Firebase-only users get a complete, policy-compliant profile.
- [ ] Duplicate email, unverified email, changed email, UID collision, legacy-ID collision, stale auth, deleted/disabled account, and interrupted linking are covered.
- [ ] Login, registration, Google sign-in, password reset, email verification, logout, returnTo/OAuth consent, waitlist, analytics and Android webview behaviour pass end-to-end tests.
- [ ] Rollback to Base44 is demonstrated without losing or duplicating account ownership.

Until these gates pass, keep `AuthContext`, `Login.jsx`, `Register.jsx`, password reset pages, and the existing Base44 account/session flow unchanged.

## Current blocker

The current blocker is the absence of a demonstrated Vercel-side Base44 session verifier and a fully rehearsed operator identity-manifest process. Firebase Admin authentication uses the existing Vercel OIDC → Google Workload Identity Federation code path, but live Firebase/Firestore configuration and preview runtime still require independent verification. The Firebase Web API key is public client configuration and cannot provide privileged Firestore or Base44 account access.

Do not deploy the deny-all starter rules as a substitute for enabling a database. Do not add a service-account JSON key to the repository or ask the owner to paste one into chat. First approve and configure an isolated staging data store and a secure server identity mechanism, then implement the bridge behind Preview-only configuration.


## Owner-scoped Books/Shelves write API — draft implementation

The migration branch now includes non-deployed create/update endpoints for the normalized owner library:

| Method | Endpoint | Behaviour |
|---|---|---|
| GET | `/api/library/books` | Paginated read of `users/{firebaseUid}/books` |
| POST | `/api/library/books` | Create a book under the verified Firebase UID |
| PATCH | `/api/library/books/{id}` | Update an existing owned book with an update-time precondition |
| GET | `/api/library/shelves` | Paginated read of `users/{firebaseUid}/shelves` |
| POST | `/api/library/shelves` | Create a shelf under the verified Firebase UID |
| PATCH | `/api/library/shelves/{id}` | Update an existing owned shelf with an update-time precondition |

Write requests require a verified Firebase token, verified email, a verified server-side identity link, and an existing normalized profile. The UID always comes from the verified token; the client cannot submit an owner UID or record ID for creation. New IDs are generated server-side. Creation uses Firestore's create-document operation, GET responses include a Firestore `version` token. PATCH requires that exact token in the `If-Match` header, compares it to the current document version, and then applies Firestore's update-time precondition to prevent stale-client overwrites. Create and update responses return the new version. Responses are projected through explicit field allowlists. Book shelf references are checked under the same UID before write. Server-owned timestamps and schema version are assigned by the API.

Sharing fields, selected-recipient arrays, storage keys, owner IDs, roles, migration metadata and arbitrary fields are deliberately not writable through these endpoints. Storage keys, share settings and recipient identifiers are also omitted from browser read projections. Sharing must use a dedicated authorization-aware API. DELETE is not implemented in this slice; shelf deletion must first handle book references, and book deletion must coordinate share-link revocation. Bulk import, idempotency keys, and frontend adapter integration remain outstanding. These routes are not deployed or wired into the existing Base44 UI. Keep Firestore client rules deny-all until every feature's server authorization and preview tests are complete.


## Firebase owner-library browser adapter — draft

The branch now includes `src/lib/firebaseLibraryApi.js`, a browser-side adapter for the owner-scoped Books/Shelves API. It obtains a short-lived Firebase ID token from the opt-in Firebase Auth module, sends it as a Bearer token, disables HTTP caching, preserves Firestore version tokens through `If-Match` on updates, and surfaces API status codes (including version conflicts) to callers. It supports paginated list, create, and update operations for Books and Shelves.

The adapter is covered by a dedicated Node test suite and is included in CI. It is deliberately not wired into `bookStore.js`, `AuthContext`, login, registration, or the active app UI: those still use Base44. The adapter cannot authorize existing readers until a verified identity link and migrated profile exist. Do not switch app reads/writes to this adapter until Firebase sign-in, account linking, profile resolution, and feature parity have passed the preview gates.


## Isolated Firebase auth preview and R2 cover metadata bridge

The `/firebase-auth-preview` route now bypasses Base44 app/session initialization in `AuthContext`, disables injected Base44 analytics on this migration branch, and restores the Firebase preview session after popup completion or page reload. This remains a test-only route; the regular login, registration, reset and application data flows still use Base44.

The Vercel Preview scope for `migration/firebase-profile-bridge` now contains the six Firebase web-app configuration variables copied from the existing normalized-migration Preview scope. The five server-side Firebase/GCP Workload Identity variables already present on the branch were compared against that source scope and matched. No Production or Development variables were changed. Firebase client configuration is public project configuration; no service-account key was copied.

The R2 cover path now has two guarded server endpoints:

- `POST /api/covers/authorize` requires a revocation-checked Firebase token, verified email, verified legacy identity link, migrated profile and an exact book document under the authenticated UID. It returns only an authorization decision.
- `PUT /api/library/books/:id/cover` requires the same verified identity/profile, an exact Firestore `If-Match` version, and a UUID object key under the authenticated UID prefix. It stores `cover_storage_key` through a dedicated server-only write path; generic book create/update payloads still cannot set that field. The key is returned only in the owner-scoped Books read projection.

The Cloudflare Worker remains undeployed and is not wired into the app. Signed-URL refresh, upload/replace/delete orchestration, image decoding/normalization, shared-reader cover access and end-to-end R2 validation remain outstanding. Do not expose the cover key through public share projections.

GitHub Actions Build validation run #382 (ID `42749310631`) passed on the current PR head `3fa5819624443619f6fe07580502b935295fbf97`, including the auth, Firestore, client-adapter, R2 cover authorization/metadata, catalogue, OCR and Vite build checks. Vercel Preview deployment creation is currently blocked by the team's free-plan daily API deployment limit (>100 deployments/day; retry window reported as 24 hours). No deployment was created for this new head.


## Isolated Firebase authentication preview — non-production guardrails

The branch adds `/firebase-auth-preview` as a separate, unprotected route for exercising Firebase email/password sign-in, verification-link handling and password reset. `AuthContext` bypasses Base44 initialisation only while this exact route is active; the normal ShelfLife login and protected routes remain on Base44. The Firebase auth exercise does not create identity links or grant access to the library.

The preview web configuration currently points to Firebase project `shelflife-tbr-9754d`, which is also the planned migration destination. A Vercel Preview branch is not by itself a separate Firebase Auth tenant or database. Until a separate non-production Firebase project is provisioned and verified, self-service account creation and Google account creation are disabled in this page. Use only a pre-approved test account for sign-in checks.

After sign-in, the optional six-collection diagnostic calls `GET /api/data/owned` with `countOnly=true`. The endpoint now requires a verified Firebase token, verified email, the same verified identity link and migrated profile as `GET /api/me`, and `countOnly=true`. It returns only a capped count, never record contents. A count of 100 is displayed as `100+`, not as an exact total.

Vercel Preview environment variables for `migration/firebase-profile-bridge` are branch-scoped and include the server-side WIF selectors plus public `VITE_FIREBASE_*` web-app configuration. No production variables or Base44 app variables were copied. The WIF provider's acceptance of this branch and the Firebase Auth authorised-domain list still require runtime verification. A fresh deployment is currently blocked by the Vercel free daily deployment API quota; the existing READY deployment predates these current branch settings and cannot be used as proof of current runtime behaviour.


## Browser-side private R2 cover adapter — draft

The branch also includes `src/lib/firebaseCoverApi.js`. It supports Worker-signed URL refresh, bounded JPEG/PNG/WebP uploads (5 MiB maximum), persistence of the returned UID-scoped object key through `PUT /api/library/books/:id/cover` with the book's current Firestore version, and cleanup of the previous object after a successful pointer update. If the Firestore pointer update fails, it attempts to delete the newly uploaded object to avoid leaving an orphan. The dedicated test suite is included in `npm run test:library-client`.

This adapter is not wired into the current UI. `VITE_COVER_STORAGE_URL` is intentionally not configured yet, the Cloudflare Worker remains undeployed, and the Worker still needs a current Preview authorization URL and exact CORS origin before it can be used. No R2 object was uploaded or deleted during this work.


GitHub Actions Build validation run #399 (ID `42749649206`) passed on code commit `046ca007e1aad816d4db4e4b21a85e244860055a`, including the Firebase library and R2 cover client adapter tests, Firestore API tests, auth tests and Vite build.


## Dual-session legacy account linking — staged, writes disabled

The branch now includes `POST /api/auth/link` and a one-to-one identity-link helper. The route requires a revocation-checked Firebase ID token with verified email plus a Base44 session token independently validated server-side through `base44.auth.me()`. It does not match accounts by email. The helper checks both forward `identityLinks/{firebaseUid}` and reverse `legacyIdentityLinks/{base44UserId}` records, refuses inconsistent or already-claimed mappings, and writes both records atomically with create-only preconditions. Profile resolution now requires both sides to agree.

The route is deliberately fail-closed: `MIGRATION_LINK_WRITES_ENABLED` defaults to false. With writes disabled it verifies both sessions and returns a proof-only result; it does not create a Firestore link. No user mappings or profiles have been written. Do not enable this flag in Production. Before enabling it in any controlled Preview, validate the dual-session UX, Base44 token lifecycle, idempotency/race handling, and operator audit requirements.

The auth test command now includes the identity-link route suite. GitHub Actions Build validation run #427 (ID `42750239042`) passed on commit `acb6242095162fcb4c6ebb4a6fd831f048cd3e70`: dependency install, Firebase/auth and identity-link tests, Firestore tests, browser library/cover tests, catalogue tests, OCR tests and Vite build all passed. Vercel still reports its daily deployment API rate limit; no current-head Preview deployment exists.


## Social graph API slice — follow, block, and relationship listing

Added authenticated server-side follow and block operations against the normalized `relationships/{sha256(followerUid\0followingUid)}` and `blocks/{sha256(blockerUid\0blockedUid)}` collections. Follow requests are pending for private profiles and accepted for public profiles. Only the followed reader can accept a pending request; either participant can remove a relationship. A block is written before existing follow edges are cleaned up, and both follow creation and acceptance check blocks in both directions. Only the blocker can remove a block. Reader IDs are derived from verified Firebase identity for the caller; target IDs are validated and target profiles must exist.

Added paginated `GET /api/relationships?direction=following|followers` with an explicit safe projection (other reader UID, status, timestamps only), and added allowlisted Firestore equality queries with document-ID cursors. Routes require a verified identity link and migrated profile; Firestore client rules remain deny-all. These APIs are not yet wired into Friends/ReaderLibrary UI, and no production data or relationship records were written.

Social graph tests and the Firestore cursor test have been added to CI. The first run after adding the social test command (#461, ID `42750709476`) failed in an existing R2 cover authorization assertion: the test expected a body for an invalid cross-owner key, while the handler correctly rejects that malformed key with HTTP 400. The assertion was corrected; a fresh current-head CI run is still required before claiming the social slice is validated.


The first social-graph CI attempt exposed test-fixture gaps rather than an application regression: the helper now requires verified forward identity links, and list operations filter both-direction blocks. The test fixtures have been updated to model both forward and reverse identity links and the block-query paths. A fresh full CI run is required to validate these latest changes.


Follow-up to the social test run: social graph operations now require both the forward and reverse verified identity-link records, matching the profile resolver. Test fixtures model both records, block-query filtering, and the correct block-route UID parameter. Run #482's failures were fixture gaps; a fresh current-head run is required to confirm the corrected suite.


## Private R2 cover Worker — source complete, deployment gated

Worker source is in `workers/cover-storage/src/index.js` with a Wrangler R2 binding config at `workers/cover-storage/wrangler.jsonc`. It is not deployed and the Worker config currently has `workers_dev=false` with no route. No Worker secrets have been set.

The Worker implementation:
- Verifies Firebase ID-token RS256 signatures against Google's Secure Token JWK set and checks project audience, issuer, expiry, issue/auth times, UID and verified email.
- Calls the Vercel `/api/covers/authorize` endpoint with the bearer token before upload or signed-read issuance. Read authorization must match the exact `cover_storage_key` stored on that owner's book.
- Accepts only JPEG, PNG and WebP, checks file magic bytes, and enforces a 5 MiB streamed-body limit before writing to the private `COVER_BUCKET` R2 binding.
- Generates owner-prefixed UUID object keys, returns five-minute HMAC-signed read URLs, validates expiry/signature before serving an object, and permits deletion only under the authenticated UID prefix.
- Uses an exact-origin CORS allowlist, no public bucket access, no object listing, and private response caching.

The Cloudflare account was inspected read-only: bucket `shelflife-tbr-covers` exists, has public R2 access disabled, has no custom domain, and currently contains zero objects. No Worker script is deployed. The bucket's lifecycle rule only aborts incomplete multipart uploads; cover objects have no automatic expiry. The separate migration-backups bucket remains private and unchanged.

Deployment remains gated until a current Vercel Preview deployment is available so the exact `AUTHORIZATION_API_URL` and browser origin can be configured and authenticated upload/read/delete smoke tests can run. Vercel currently refuses new deployments at the free daily API deployment quota. No plan upgrade, Worker deployment, secret creation or R2 upload was attempted.


The latest social-graph test run (#508, ID `42751320075`) found two remaining fixture/expectation issues: an inverse-direction unblock request should return `unblocked:false` rather than reveal another reader's block, and the missing-target-identity test fixture was auto-populating the very link it intended to omit. Both tests were corrected. The current helper now checks both forward and reverse identity-link records, and the route test uses the correct UID query parameter. Awaiting fresh current-head CI.


The latest run (#514, ID `42751487387`) narrowed the remaining social suite failures to test-fixture issues: the intentionally unmapped reader fixture dereferenced its absent forward link while building reverse fixtures, and the block handler test used a query parameter although the route correctly accepts `blockedUid` in the POST body. Both fixtures are corrected; another current-head CI run is required.


GitHub Actions run #520 (ID `42751635409`) passed Firebase/auth, Firestore, browser library/cover, and the complete social graph API suites. It then failed in the existing R2 Worker test because the generated object-key assertion escaped the filename dot twice. The Worker implementation itself returned a correctly scoped UUID key; the test regex has been corrected. A fresh full workflow is required to confirm R2 Worker, catalogue, OCR and Vite build.


## Group chat API slice — staged

Added `GET /api/groups/:id/messages`, `POST /api/groups/:id/messages`, and owner-only `DELETE /api/groups/:id/messages/:messageId`. Reads and writes require a verified migrated Firebase account, an existing group, and active membership (or group ownership); removed members are explicitly denied. Message authorship and display name come from the verified session/profile, never the request body. Message bodies are normalized and bounded to 1,000 characters; read responses use an explicit allowlist and paginated document-ID cursors. Message deletion uses Firestore update-time preconditions.

These APIs are staged and not yet connected to the existing Base44 actor/WebSocket UI. They do not provide live presence or real-time push; the app still uses Base44 actors for the active group-chat screen. New helper/handler tests and a CI test step have been added; validation is pending.

GitHub Actions Build validation run #524 (ID `42751763279`) passed the full previous code head, including the social graph API suite, R2 Worker, catalogue, OCR and Vite build. The group chat API slice was added after that run and needs its own full CI pass.


GitHub Actions Build validation run #540 (ID `42752035166`) passed the group chat helper/handler tests and all prior auth, Firestore, Books/Shelves, social graph, R2 Worker, catalogue, OCR and Vite build checks. The nested Vercel route import paths were corrected after that run; a fresh CI run is still needed to validate the latest route files.


## Group chat API slice — authenticated reads and writes

Added `GET /api/groups/messages?groupId=...`, `POST /api/groups/messages` with `{groupId, body}`, and owner-only `DELETE /api/groups/messages?groupId=...&messageId=...`. All routes require a verified Firebase bearer token, verified email, verified bidirectional legacy identity mapping, and a migrated profile. Membership is checked server-side against `groups/{groupId}/members/{uid}`; removed-member tombstones take precedence over active membership. Group owners are recognized from the group document's `ownerUid`. The message projection is allowlisted, messages are limited to 1,000 characters, author UID/display name come from the authenticated account/profile, and deletion uses Firestore's last-update-time precondition. The client cannot supply author identity or arbitrary message metadata.

Added unit coverage for active/removed/non-member access, message pagination, safe field projection, bounded message creation, owner-only deletion and optimistic concurrency handling, plus HTTP route authentication and payload validation. These routes are backend-only: the existing group chat UI has not been switched from Base44, Firestore rules remain deny-all, and no production group or message data has been written. Before UI integration, verify the actual migrated group/member document schema and reconcile it with this API contract; then run the full CI suite and preview runtime tests.


## Group membership lifecycle — staged

Added Firebase APIs for group creation, owner-issued invitations, invite acceptance/decline, owner removal, member leave, and owner closure. Group creation uses an allowlisted schema and creates the owner membership. Invitees must have a verified, bidirectional identity link. Invite acceptance is retry-safe; removed-reader markers deny chat access and prevent re-invitation. Removal revokes a pending invite. Closing a group is a version-guarded soft close; chat access is denied while historical group/message documents are retained.

The routes and helper/handler tests are included in the migration branch. The existing Base44 group discovery, invite and roster UI remains on Base44; these Firebase APIs are not yet wired into it. Public group discovery/join and a full migrated group-list/roster read API remain outstanding. A dedicated CI step for group membership tests has been added; validation is pending.


The first group membership CI run (#583, ID `42752601370`) failed because the Firebase UID control-character validation pattern was over-escaped and rejected ordinary IDs. The current `groupMembership.js` validator has been corrected to use the intended control-character range; the full group membership suite must be rerun on the latest branch head before considering this slice validated.


GitHub Actions Build validation run #589 (ID `42752733055`) passed on the group membership head: auth/identity, Firestore, Books/Shelves adapters, social graph, group chat, group membership, R2 Worker, catalogue, OCR and Vite build all passed.


The group chat API now also has a browser adapter (`src/lib/firebaseGroupChatApi.js`) for authenticated paginated reads, message sends and owner-delete requests. Adapter tests are included in `test:group-chat`. It remains intentionally unwired because the normal application AuthContext still uses Base44; the adapter cannot be used safely until Firebase sign-in and verified account linking are active for the reader.

Group membership operations are exposed through backend route wrappers: `POST /api/groups` (create), `POST/PATCH /api/groups/invites` (invite/respond), `DELETE /api/groups/members` (remove), and `DELETE /api/groups/membership?action=leave|close`. These endpoints remain staged and are not wired into the current Base44 group pages. The Firebase group chat backend and adapter have no production traffic.


The group membership slice now also includes `POST /api/groups/:id/join` for verified readers joining public groups, and `GET /api/groups/:id/members` for safe roster reads. Private groups remain invitation-only; removed readers cannot rejoin. Active members can see the active roster; only owners receive pending invitee details. The roster response exposes IDs, display names and roles only. Public group discovery and a user-scoped group list index are still outstanding.


The group backend now includes scoped list reads for owned/joined groups, pending invitations, and public groups. The listing code uses authenticated UID-scoped collection queries and an allowlisted group projection. A browser adapter (`src/lib/firebaseGroupApi.js`) now covers list/create/invite/respond/remove/leave/close operations, with tests included in `test:group-membership`. These group adapters remain staged until Firebase auth is active in the normal app; the Base44 BookGroups and BookGroupRoom pages have not been switched. Group roster/profile display enrichment, invitation inbox reads and realtime/presence still need a dedicated migration slice.


Group membership reads now include a safe roster endpoint: active members can view the roster; only the owner receives pending invitations. Public group joining is exposed through `POST /api/groups/join?id=...` and uses the authenticated UID, refuses private groups and respects removal tombstones. The browser group adapter covers public join and owner roster reads as well. The group pages remain on Base44 until the main application Firebase auth cutover is validated.


Group list responses now include the deterministic invitation document ID for pending invites, so a client can submit an accept/decline response without exposing legacy account identifiers. Group roster reads are membership-authorized; active members see active member names, while only the owner sees pending invitation names. The Firestore REST client now marks collection-group queries with `allDescendants: true`, required by Firestore's structured query API. Its query limit validator permits 101 records for one-record lookahead and rejects values above that bound.


## Group directory and invite inbox — staged

Added `GET /api/groups?scope=mine|public|invited`. The endpoint returns a bounded allowlist of group metadata; `mine` combines owned and active memberships, `public` uses a paginated boolean filter, and `invited` returns pending invitations with the invite ID required to accept/decline. Firestore REST now supports collection-group equality queries and boolean filters, and query snapshots expose the parent group ID for nested member/invite documents. Non-public scopes fail rather than silently truncate beyond their safe result limit; cursors are accepted only for public discovery.

The existing BookGroups UI still uses Base44 and is not switched to these endpoints. Current-head CI is pending after the collection-group query support, pagination safeguards and group-list test fixture corrections.


Group removal tombstones now distinguish voluntary departure from owner removal. A reader who leaves is marked `reason: left`; the owner may invite them again, and acceptance atomically progresses the marker to `reason: rejoined` after the membership write. Group chat and roster access recognize the rejoined state. Owner-removed readers remain blocked from re-invitation, and public self-join remains blocked for any tombstoned reader. This preserves the existing UI promise that an owner can invite a voluntary leaver back without allowing an owner-removed reader to bypass moderation.


The group-directory test run (#694, ID `42753578406`) failed because the pre-existing group client adapter test still asserted obsolete flat API paths and contained an invalid regular-expression literal. The client adapter has since been aligned with the actual nested Vercel routes for invite/join/respond/roster/remove/leave/close, and now also supports group chat read/send/delete. Its tests were rewritten against those paths. The group-list fixtures were corrected to distinguish owner, active-member and left-member records; Firestore REST collection-group and boolean-query tests were added. A fresh current-head full CI run is required.


The group and group-chat browser adapters now target nested REST paths (for example `/api/groups/{groupId}/messages`) and matching Vercel dynamic API route files. This aligns create/invite/respond/join/roster/remove/leave/close and message read/send/delete with one consistent group resource path. The older flat route wrappers remain only as compatibility endpoints on the migration branch; the current adapter uses the nested routes. These endpoints are still staged and not wired to the Base44 group pages.


GitHub Actions Build validation run #713 (ID `42753852931`) passed on the current group-directory/client-adapter head. The full workflow passed Firebase token/identity tests, Firestore REST and normalized library APIs, Books/Shelves and cover client adapters, social graph, group chat, group membership/directory, R2 Worker, catalogue, OCR and Vite build.


## Isolated group UI preview — staged

Added `/firebase-groups-preview`, an isolated React preview harness for the Firebase group directory, create/join/invite/respond, roster, member management, leave/close and group chat flows. It observes the Firebase session directly and bypasses Base44 AuthContext initialization for this route. The route is disabled unless `VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED=true`. That variable has been created and read-back verified only for Vercel Preview on branch `migration/firebase-profile-bridge`; no Production or Development environment was changed. The Firebase auth preview links to this page after sign-in, but the group APIs still require a separately verified legacy identity link and migrated profile.

The preview UI is not part of the active ShelfLife navigation and has not been deployed or runtime-tested because the Vercel daily deployment API limit remains in effect. Current-head GitHub CI must validate the React/Vite build and updated group client tests.


## Sharing permissions and public links

Added a dedicated sharing API rather than allowing the general Books/Shelves write endpoints to modify permissions. `PATCH /api/library/books/{id}/sharing` and `PATCH /api/library/shelves/{id}/sharing` require a verified migrated Firebase account, the owner-scoped resource, and an `If-Match` Firestore version. The request allowlist supports enabled state, circle/selected audience, selected Firebase UIDs, and public-link toggle only. Selected recipients must each have a verified forward/reverse identity mapping and an accepted Reading Circle relationship; blocks in either direction deny access. Private shelves cannot be shared.

Share settings, recipient UIDs, link ID, and link creation/revocation are committed together using preconditioned Firestore writes. Raw link tokens are generated server-side, returned only on creation, and never stored in Firestore; only a SHA-256 token hash is stored in `shareLinks/{hash}`. Public token resolution is available at `GET /api/share/{token}`; it returns a strict book/shelf projection and excludes personal notes, reviews, ratings, internal share IDs, and private storage metadata. Shelf share responses are bounded to 100 books per request.

The migration planner now normalizes legacy sharing fields to `shareEnabled`, `shareAudience`, `sharedWithUids`, and `shareLinkId`, and creates disabled ShareLink records for selected-recipient audiences. The owner library read projection includes normalized share state; the generic write allowlist still excludes it. Browser adapter and helper/handler tests are included in `test:sharing` and the CI workflow. Selected-recipient read access, shared-with-me discovery, and switching the existing SharePanel/public share pages from Base44 remain outstanding. No production share settings or links were written.


The first group-preview CI run (#749, ID `42754418978`) stopped in the Firestore library suite because normalized owner projections now intentionally include `sharedWithUids`, `shareEnabled` and `shareAudience` for the owner share-management UI; two old assertions still expected those fields to be hidden. The tests now assert the normalized owner-only fields are returned while legacy `shared_with_ids` and `shared_with_names` remain excluded. The isolated group preview page and Preview-only feature flag are now in the branch; current-head CI is pending.


The sharing slice now includes `GET /api/shared` for the authenticated reader's selected-recipient and Reading Circle feed. It uses Firestore collection-group queries, including `array-contains` for `sharedWithUids`, then independently rechecks verified identities, current circle relationships and blocks in both directions. Selected shares remain visible after a reader leaves the circle unless either party blocks the other. The feed returns safe book/shelf projections and omits notes/reviews/ratings. A browser adapter exposes share-setting updates, public-link resolution and the shared-with-me feed. Public token route and handler tests are registered in CI. The existing SharePanel and public share pages still use Base44 and are not switched.


## Comments and moderation reports

Added `GET/POST /api/comments`, `DELETE /api/comments/{id}`, and `POST /api/comments/{id}/report`. All routes require verified Firebase email, a migrated profile and bidirectional identity verification. Comment reads/writes are allowed only to the target owner or a reader who can currently access the shared book/shelf under its circle/selected-recipient permissions; blocks in either direction deny access. Author UID and display name are derived from the verified session/profile. Comment body is plain text, bounded to 2,000 characters, and parent replies must belong to the same target. Author or target owner may soft-delete a comment; reports are deduplicated per reporter/comment and stored in `moderationReports` with bounded reason/excerpt. The browser adapter and handler/helper tests are registered in `test:comments` and CI.

The moderation report queue/reviewer workflow and existing Base44 comment UI have not been migrated or switched. No production comments or reports were written.


## Shared-item comments and reporting — staged

Added authenticated comment list/create/delete/report APIs and a browser adapter. Discussion access is checked against the book/shelf owner, normalized sharing settings (selected recipients or accepted circle relationships), verified identity links and bidirectional block records. Comment authorship/name are server-derived; replies must reference a comment in the same target discussion. Reads are cursor-paginated. Authors or target owners can soft-delete comments; a removed-comment placeholder preserves thread structure. Reports are deduplicated per reporter/comment and written to `moderationReports` with a bounded reason and excerpt. The API does not expose a moderation queue or admin decision workflow yet.

The existing book/shelf detail UI still uses Base44 comment entities. The Firebase comments adapter is staged and not wired into active UI. Dedicated helper, handler and browser-adapter tests are included in CI; current-head validation is pending.


The first comments CI run (#863, ID `42755508119`) stopped in the normalized library suite before reaching comments. The failure was an incorrect pagination test fixture: it supplied one document for a page size of one, but the implementation correctly requires a second look-ahead document before returning a next cursor. The fixture now includes that second document. The comments helper now supports document-ID cursors, preserves deleted-comment placeholders for thread integrity, and records reporter/author display names in moderation reports.


## Safe Books/Shelves deletion

Added owner-scoped `DELETE /api/library/books/{id}` and `DELETE /api/library/shelves/{id}` with mandatory `If-Match` version preconditions. Deletion is a soft tombstone (`deletedAt`) rather than a destructive Firestore delete. Owner library reads hide tombstoned records; later edits/cover changes, share resolution, shared feeds and comments reject them. Book deletion disables selected sharing and revokes any active public link. Shelf deletion atomically detaches the shelf ID from every owned book that references it, tombstones the shelf, and revokes its public link. Shelf cleanup is limited to 100 matching books per atomic commit; larger operations fail closed rather than partially update.

Book cover objects are deleted through the private R2 Worker using the verified user's Firebase bearer token and owner-prefixed object key. When the worker is unavailable or cleanup fails, the deleted book retains `coverCleanupPending` for a later retry; when cleanup succeeds, the object key is cleared with a version-preconditioned Firestore update. The browser library adapter exposes version-guarded book/shelf deletion. Tests cover atomic shelf detachment, share-link revocation, R2 cleanup, handler authorization and optimistic concurrency. No production records or R2 objects were changed.


The comments CI run (#884, ID `42755669302`) failed before executing comment tests because the newly added control-character regex for report reasons was double-escaped, producing an invalid character-class range. The regex is corrected to the standard single-escaped control-code range. The browser comments adapter now forwards the document-ID cursor, and the helper tests cover multi-page reads and deleted-comment thread placeholders. A fresh full CI run is required.


## Idempotent migration apply engine — guarded, not enabled

Added `scripts/migration/apply-create-only.js` as a testable, resumable create-only executor for a reviewed migration plan. It is deliberately separate from the dry-run CLI and is not called by any API route or deployment workflow.

Safety properties:
- Writes require an explicit `allowWrites: true`, an explicit `environment: "non-production"`, and a target project ID different from the known ShelfLife source/production Firebase project.
- A bounded batch is capped at 500 documents; duplicate target paths and malformed document paths are rejected before writes.
- Existing documents are compared using canonicalized data. Exact matches are skipped, allowing safe retries after partial completion; mismatches stop the batch and are never overwritten.
- Concurrent create conflicts are read back and treated as idempotent only when the resulting document exactly matches the plan.
- The executor exposes no update, delete, or overwrite operation. The existing dry-run CLI remains write-free.

Unit tests cover default-off behavior, production/source-project rejection, create-and-retry, conflict protection, malformed/duplicate paths, bounded batches and concurrent conflicts. CI now includes `npm run test:migration-apply`. This is code-level validation only: no Firebase project was contacted, no target environment has been configured, and no import has been run.


Run #901 (ID `42755810121`) passed auth and normalized Firestore tests but failed a library-delete regression assertion: the delete handler did not forward the authenticated Firebase bearer token to the private-cover Worker cleanup request. The current handler now extracts the request bearer token and passes it with the authenticated UID; Worker cleanup failure remains non-fatal and leaves `coverCleanupPending` set. The Firestore REST query limit now permits the one-document lookahead used by bounded library/sharing pagination. Shared-with-me records now include the authorized owner's UID so the comments adapter can target the correct discussion. A fresh full CI run is required.


### Importer target-binding hardening

The importer does not trust the caller-supplied target project label by itself. The Firestore REST client now exposes its immutable configured `projectId`, and the executor requires an exact match between that actual client binding and the declared non-production target. Tests reject a client bound to the ShelfLife production project even when the caller labels the target as staging, and reject any mismatched project ID. The current application Firestore client is hard-bound to `shelflife-tbr-9754d`, so it cannot pass the importer gate; a separately configured and independently verified non-production client is required before any rehearsal writes can occur.


The comments slice now includes a server-side moderation queue: `GET /api/moderation/reports` lists open reports and returns Firestore version tokens; `PATCH /api/moderation/reports/{id}` supports `dismiss` or `hide_comment`. Moderator access is controlled exclusively by the server-side `SHELFLIFE_MODERATOR_UIDS` allowlist after verified Firebase auth and profile resolution; no client-supplied role or reviewer UID is trusted. Hiding a comment and resolving its report are committed atomically. If the allowlist is unset, the moderation endpoints deny all callers. The reviewer UI is not migrated yet.


Run #938 (ID `42756070460`) failed the new create-only importer safeguard test because the importer version on that commit began writes before validating the entire batch; duplicate/malformed paths could therefore leave partial records. The current importer now validates every path, duplicate, size limit and existing target conflict before the first write, then uses create-only writes and conflict read-back for concurrent races. This helper remains disabled by default, requires explicit non-production opt-in and a separate Firebase project ID, and is not called by any deployed route. No migration data was imported; a fresh CI run is required.


The current-head CI run #955 (ID `42756151583`) passed the new importer safeguards, Firebase auth/identity, Firestore, Books/Shelves client, social graph, group chat, group membership, and sharing suites. It then failed in one comments soft-delete test fixture: the seeded comment omitted `targetKind` and `targetId`, so the correctly scoped list query returned no row. The fixture now includes both target fields. A fresh full CI run is required; the moderation, R2, catalogue, OCR and build steps were skipped after the failure.


The corrected comments fixture was validated on current PR head `41357e88cfeb59ee5d4157c0cf04e072ee3e6e6d`: GitHub Actions Build validation run #961 (ID `42756243563`) completed successfully. It passed the idempotent importer safeguards, Firebase auth/identity, Firestore, Books/Shelves client, social graph, group chat, group membership/directory, sharing, comments/moderation, moderation review, private R2 Worker, catalogue, OCR and Vite build. Vercel Preview remains separately blocked by the daily build-rate limit; this green CI run is not a live Preview runtime test.


## Further migration slices — comments, moderation, deletion and import safeguards

- The create-only migration executor remains default-off and is covered by `test:migration-apply`. It requires an explicit non-production opt-in and a Firestore client bound to a separate non-production project, preflights every document, creates only missing documents, skips exact matches on retry, and stops on conflicting content. It has not been run against any Firebase target.
- Comments now support authenticated list/create/soft-delete/report routes and a browser adapter. The server derives author identity, checks current share permissions and blocks, bounds plain text, constrains replies to the same discussion, and permits deletion by author or target owner.
- Moderation reports have a server-allowlisted queue and atomic dismiss/hide actions with version tokens. The `SHELFLIFE_MODERATOR_UIDS` environment variable controls moderator access; unset means deny all. No reviewer UI is connected.
- Books/Shelves deletion is soft, version-guarded and owner-scoped. Shelf deletion queries only matching `shelfIds` and detaches those references in the same atomic Firestore commit. Book deletion revokes sharing and attempts owner-authenticated R2 Worker cleanup; pending cleanup remains marked for later retry.
- GitHub Actions run #915 (ID `42756125395`) passed the idempotent importer, Firebase auth, Firestore, library, social graph, group chat, group membership and sharing suites. It failed the comments suite on a test fixture that omitted target identifiers from a manually seeded comment; the fixture has been corrected. A new full CI run is required for the latest comments/moderation/deletion changes.
- No production import, data mutation, Firestore rule relaxation, R2 upload, deployment, merge, republish or cutover occurred. The normal app still uses Base44; the migration branch remains isolated and the published app remains offline.
