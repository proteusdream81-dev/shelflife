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
