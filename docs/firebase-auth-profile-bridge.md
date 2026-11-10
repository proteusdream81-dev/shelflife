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
