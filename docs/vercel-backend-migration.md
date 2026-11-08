# ShelfLife: Base44-to-Vercel backend migration

## Status

This branch establishes the Vercel API runtime and migration plan. It does **not** switch production traffic, remove Base44, or migrate persistent data. Base44 remains the production backend until each replacement is implemented, tested, and explicitly cut over.

## Current architecture found in `main`

- React + Vite frontend.
- Base44 SDK is the frontend API/auth/data client (`src/api/base44Client.js`, `src/lib/AuthContext.jsx`).
- Base44 backend functions are Deno entrypoints under `base44/functions/*/entry.ts` and import `npm:@base44/sdk`.
- Base44 entity schemas are under `base44/entities/`; application code also calls `base44.entities.*` directly, so migrating only function invocations would leave a Base44 dependency.
- Firebase is currently used for custom book-cover Storage, not as a proven replacement for the primary database/auth.
- Function handlers depend on Base44 auth, entity CRUD, service-role access, rate-limit/cache entities, and some Base44 runtime facilities. These need explicit replacements.

## Vercel runtime probe

- `api/health.js` is a minimal Node.js serverless function.
- It has no credentials and does not access production data.
- Once this branch is connected to a Vercel project, `GET /api/health` should return `{ ok: true, service: "shelflife-api", runtime: "vercel" }`.

## Detailed frontend dependency inventory

See [`base44-frontend-dependency-inventory.md`](./base44-frontend-dependency-inventory.md) for the source-level map of direct frontend SDK usage, feature domains, entity families, authorization requirements, and the recommended porting order. This inventory is required because replacing the server functions alone would leave active Base44 calls in the client.

## Backend functions to migrate

1. accountDeletion
2. authorReleases
3. bookCovers
4. bookFormats
5. bookGroups
6. bookSeries
7. comments
8. confirmWaitlistTester
9. discoverBookClubs
10. enrichBooks
11. getSharedShelf
12. identifyBook
13. joinWaitlist
14. nearbyPlaces
15. readingCircle
16. releaseReminders
17. searchBooks
18. testerOutageNotice
19. weeklyTrending

Also review the `BookGroupRoom` actor and scheduled/triggered workflows; they are not ordinary HTTP functions.

## Migration order

### Phase 0 — safe foundation (this branch)
- Add a Vercel Node serverless health endpoint.
- Keep all existing Base44 code and production behaviour unchanged.
- Establish a function/entity/auth dependency inventory before porting.

### Phase 1 — data and identity contract
- Choose the replacement primary database and auth provider.
- Define a stable user ID mapping and ownership model.
- Design migrations for every entity schema and indexes/uniqueness constraints.
- Plan export, import, reconciliation, backup, and rollback. Do not write to production data during rehearsal.

### Phase 2 — shared backend primitives
- Replace Base44 request authentication with verified session/JWT validation.
- Replace entity CRUD and service-role operations with scoped database repositories.
- Port rate limits, caching, block checks, email delivery, storage, and scheduled jobs.
- Keep secrets server-only in Vercel environment variables.

### Phase 3 — port endpoints
- Port one endpoint at a time, preserving request/response shapes and status codes.
- Add tests for unauthenticated access, ownership/authorization, validation, rate limits, error handling, and expected success paths.
- Prioritize read-only/catalogue endpoints, then social/group flows, then destructive account deletion and scheduled jobs.

### Phase 4 — frontend adapter
- Replace `base44.functions.invoke`, `base44.entities.*`, and `base44.auth.*` behind a single API/auth adapter.
- Remove Base44 SDK and Vite plugin only after no application import or runtime dependency remains.
- Keep Firebase Storage only if still required and its security rules are verified.

### Phase 5 — rehearsal and cutover
- Deploy preview environment and run integration tests against a staging database.
- Export and migrate production data with counts/checksums and a rollback snapshot.
- Verify auth, shelves/books, groups/invites, comments, sharing, waitlists, reminders, search and deletion.
- Cut over only after explicit approval; retain Base44 access until post-cutover verification completes.

## Blocking inputs for a real production migration

- Vercel project access and target team/project.
- A selected production database and credentials provisioned as Vercel environment variables.
- Auth-provider decision and existing Base44 user/session migration strategy.
- Access to Base44 production data export and current integration secrets (never commit secrets).
- Email, book-catalogue, maps/places and other third-party provider credentials.

## Google Play internal-testing protection

ShelfLife is already distributed through the Google Play internal-testing track (owner-confirmed). Treat that release as an active test environment, not a disposable preview.

- Keep the currently published internal-test artifact and its existing backend configuration working throughout migration.
- Do not change API base URLs, auth/session handling, app identifiers, signing, versioning, or release-track settings as part of backend-only staging work.
- Validate each replacement API against the exact request/response contract expected by the installed internal-test build before changing its configuration.
- Use a separate Vercel preview deployment and non-production database for Android compatibility tests.
- Require a new Android build and an explicitly approved internal-track rollout only if the client must change; never replace or promote the current track automatically.
- Keep a rollback path to the existing Base44-backed client/backend until the replacement passes end-to-end tests on the internal-test build.

## Safety rules

- Never commit API keys, service-role secrets, tokens, or database URLs.
- Do not point a preview deployment at production data.
- Do not delete or disable Base44 resources during migration.
- Do not migrate unfinished MFA templates from the historical local sandbox.
- Do not deploy or switch production traffic without explicit approval.

## Firebase project discovery (owner-confirmed)

- The owner has opened the Firebase Console and identified project `shelflife-tbr-9754d` under the Google account `admin@codelustre.com`, managed by `codelustre.com`.
- The Console currently shows the project as ready to add an app. This confirms the project is visible to the owner, but does not establish that a Firebase web app is registered or that Authentication, Firestore, or Storage are configured.
- The previously supplied project ID `shelflife-511306` is superseded and must not be used unless independently verified as a separate intended project.
- Do not create resources, enable services, change IAM, deploy Firebase rules, or assume Firebase is approved as the primary database/auth provider without inspection and explicit owner direction.
- Preserve existing Firebase Storage use for book covers until parity and security rules are verified.

### Firebase configuration status

The Firebase JavaScript SDK is already a project dependency (`firebase` `^11.0.0`); no additional npm install is required. The existing `src/lib/firebase.js` module reads the six web-app values below and uses them for the current book-cover Storage upload flow:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The starter `.env.example` now uses the owner-confirmed project ID `shelflife-tbr-9754d`. This is a template only: it does not configure the deployed app or create Firebase resources. The remaining web-app values must be copied from the Firebase Console after registering/identifying the correct web app. Do not invent them or place Admin SDK service-account credentials in any `VITE_*` variable; Vite variables are shipped to the browser.


## Handler contract and migration risk inventory

The following is a first-pass source inspection of the current Deno handlers. It identifies the existing operations and trust boundaries to preserve; it is not a replacement implementation or a claim that all edge cases have been captured. Freeze representative request/response fixtures from the running Base44 app before porting any handler.

| Handler | Observed operations / response shape | Identity boundary | Base44 data dependencies / notable risk |
|---|---|---|---|
| `accountDeletion` | `current`, `request`, `confirm`; confirmation-code flow | Signed-in user for account actions; email/code workflow also touches service-role records | `User`, `AccountDeletionRequest`; destructive wipe must be last and idempotent |
| `authorReleases` | Returns release list plus author scan counts | Signed-in user; rate limited | `Book`; catalogue/provider response and pagination compatibility |
| `bookCovers` | Returns `{ covers }` | Signed-in user; rate limited | External book-cover lookup; preserve provider quotas and image URL handling |
| `bookFormats` | Returns `{ formats }`; cached lookup | Signed-in user; rate limited | Shared cache helpers; preserve cache keys/expiry and response shape |
| `bookGroups` | `members`, `close`, `invite`, `accept`, `decline`, `leave`, `join` | Signed-in user; group owner/member/invitee checks; block checks | `BookGroup`, `GroupInvite`, `User`; membership races, capacity limits and invite authorization |
| `bookSeries` | Returns series lookup result | Signed-in user; rate limited | External catalogue lookup; title/ISBN validation |
| `comments` | `list`, `create`, `remove`, `report` | Signed-in user; target visibility, ownership, block and report-rate checks | `Comment`, `Report`; asynchronous runtime dependency and moderation rules |
| `confirmWaitlistTester` | Token-based confirmation HTML page | Guest token endpoint; guest rate limit | `Waitlist`; token expiry/replay handling and HTML response compatibility |
| `discoverBookClubs` | Returns `{ clubs }`; cached search | Signed-in user; rate limited | `ClubSearchCache`; external place/club search and cache policy |
| `enrichBooks` | Returns `{ results }` | Signed-in user; rate limited | External book and cover lookup; preserve partial-result semantics |
| `getSharedShelf` | Returns public shared shelf/list payload | Guest token endpoint; guest rate limit | `User`, `Shelf`, `Book`; share-token privacy and public-field projection |
| `identifyBook` | Image-to-book lookup; returns candidate books and guess | Signed-in user; rate limited | External vision/book lookup; upload size/type validation, cost controls and provider secrets |
| `joinWaitlist` | Form/JSON submission; returns success/already-on-list/confirmation state | Guest endpoint; visitor/email throttling | `WaitlistAttempt`, `Waitlist`; supports form-encoded/multipart and JSON inputs; confirmation email |
| `nearbyPlaces` | Returns `{ places }`, cache/stale indicators | Signed-in user; rate limited | `PlacesCache`; external maps/place providers, fallback and timeout behaviour |
| `readingCircle` | `library`, `overview`, `search`, `follow`, `unfollow`, `respond`, `remove_follower`, `block`, `unblock`, `username` | Signed-in user; per-reader privacy, follow state and block enforcement | `ReaderSearch`, `User`, `Shelf`, `Follow`, `Block`, `Book`; highly sensitive authorization surface |
| `releaseReminders` | Syncs and returns connected reminder state/list | Signed-in user; user-scoped records | `Book`, `ReleaseReminder`; external calendar OAuth token and remote event create/update/delete |
| `searchBooks` | Returns `{ books, partial }` | Signed-in user; rate limited | External catalogue lookup; partial-result behaviour and provider throttling |
| `testerOutageNotice` | Admin dry-run or sends outage notice; returns recipient/send counts | Admin-only | `User`; email provider secrets and recipient cap |
| `weeklyTrending` | Returns trending books; admin-only refresh path | Public/read path plus admin-only refresh path | `Book`, `BookSearchCache`; scheduled/cache refresh and admin authorization |

### Cross-cutting implementation gates

- Preserve the guest endpoints (`joinWaitlist`, `confirmWaitlistTester`, `getSharedShelf`) without accidentally making user-owned data public. Their rate limits and token semantics are part of the security contract.
- Rebuild `requireUser`, `isBlocked`, `blockedIdsFor`, `withinLimit`, `tooMany`, `withinGuestLimit`, and `serverError` as shared, tested Vercel-side primitives before porting dependent handlers.
- Never trust a client-supplied user ID for ownership. Resolve identity from a verified session/token on the server, then apply the existing owner/member/admin checks.
- Keep provider credentials and calendar OAuth refresh/access tokens server-side. Do not move them into Vite `VITE_*` variables.
- Treat account deletion, group membership/invites, follow/block changes, comment moderation, waitlist confirmation and calendar event deletion as mutation-sensitive operations. Add replay/idempotency and authorization tests before cutover.
- `comments` currently imports `waitUntil` from `base44:runtime`; identify an equivalent Vercel-supported post-response/background strategy or deliberately redesign the side effect before removing the Base44 runtime.
- `releaseReminders` depends on an external calendar access token; define its OAuth ownership, refresh and revocation lifecycle before migration.
- `testerOutageNotice` and `weeklyTrending` contain admin paths. Recreate role checks using trusted server-side claims/records, never a client-editable profile field alone.
- The table is a migration map, not a substitute for full per-handler tests. Capture exact input validation, status codes, response bodies, cache TTLs, limits and external provider semantics from source and staging fixtures.


## Data model, authorization, and realtime contract

A second source inspection of the Base44 entity schemas and the `BookGroupRoom` actor adds the following migration requirements. Treat these as behavioural contracts, not as a final Firestore schema. The existing entity definitions include Base44-managed metadata and row-level rules that must be mapped deliberately rather than copied mechanically.

### Core data model

- **Users and identity:** the `User` profile carries a role (`admin` or `user`), a unique lowercase username, profile visibility, cover/content-warning preferences, storefront preference, and testing-banner preferences. The replacement must separate Firebase Authentication identity from the application profile. Keep the stable user ID mapping explicit; never accept a client-supplied role or owner ID as authority.
- **Books and shelves:** `Book` contains catalogue metadata plus reader-owned state (reading status, notes, review, rating, format, series, content warnings, spice fields), shelf references, and per-book sharing controls. `Shelf` carries privacy and share-token/audience settings. Preserve multi-shelf membership and the distinction between owner-visible data and public/selected shared projections.
- **Social graph:** `Follow` supports pending and accepted requests; legacy rows with no status are treated as accepted. `Block` is directional in storage but must be enforced in both directions across discovery, follows, invitations, comments, and shared views.
- **Groups:** `BookGroup` stores owner, privacy, member IDs and owner-removed IDs. `GroupInvite` is visible to inviter and invitee, and only the invitee can accept/update it. A pending invitation does not grant membership.
- **Private operational records:** `AccountDeletionRequest` stores a hash rather than the raw code, a 15-minute expiry, attempt count and one-use marker. `ReleaseReminder` stores the external calendar event ID and must remain owner-scoped. Cache, report, waitlist and rate-limit entities also require explicit access policies.

### Authorization and database design implications

- Base44 row-level rules currently scope shelf and reminder CRUD to `created_by_id`; private groups are readable by owner/member, public groups are readable broadly, and invites are readable by inviter/invitee. Reproduce these policies in server repositories and Firestore Security Rules, with server-side authorization for privileged mutations.
- A user's profile role is not by itself a trusted admin credential if clients can edit that profile. Admin actions need a server-controlled claim or an independently protected role record, with a documented grant/revocation process.
- Username uniqueness, share-token uniqueness, follow-pair uniqueness, invite state transitions, and group membership changes need transactional or otherwise race-safe enforcement. Do not rely on a client-side preflight query.
- Sharing must use explicit response projections. Never expose email, private notes, hidden profiles, unshared books, private shelves, deletion-code records, or operational cache/rate-limit data through a broad document read.
- For account deletion, preserve the existing multi-entity cleanup semantics, including removing the user from other owners' group rosters and deleting inbound/outbound follows, blocks, invites and search records. Design a resumable deletion job with a completion marker; do not assume one Firestore batch can delete an arbitrarily large account.
- Preserve legacy follow rows without a status as accepted during import or through a compatibility read until data is normalized.

### Book-group realtime actor

`base44/actors/BookGroupRoom/entry.ts` is a persistent realtime actor, not an ordinary request handler. It enforces authenticated platform identity before sending history, re-reads the group record on connect and moderation, restricts private rooms to owner/members, rejects owner-removed readers, caps a room at 40 concurrent readers, returns at most 120 history messages, retains at most 300 messages, limits message bodies to 1,000 characters, and permits only the group owner to delete messages/remove readers. Message authorship comes from verified connection identity; display names are labels only.

A Vercel HTTP function plus Firestore alone does not automatically replace this websocket/presence behaviour. Choose and test a realtime transport (or explicitly redesign the chat experience) before removing the actor. The replacement must re-check authorization on connect and on privileged actions, support immediate removal, bound history/storage, and prevent spoofed author IDs.

### Porting gates added

1. Finalize Firestore document ownership, collection paths, indexes and security rules from the above contracts before importing data.
2. Add transaction tests for username uniqueness, follow/invite/group transitions, share-token access, and account deletion replay/resumption.
3. Add privacy tests for owner, selected-share recipient, circle follower, blocked reader, anonymous visitor and admin roles.
4. Decide the realtime chat transport and prove Android/web client compatibility before planning actor retirement.
5. Reconcile every imported entity count and ownership relationship against a read-only Base44 export before any production cutover.


## Proposed Firebase data model and rules

See [`firebase-data-model-and-security-rules.md`](./firebase-data-model-and-security-rules.md) for the proposed Firestore collection layout, ownership and privacy invariants, transaction requirements, index hypotheses, migration validation plan, and open provider decisions.

A root-level `firestore.rules` file has also been added as a **deny-all starter**. It is intentionally not deployed. Vercel Admin SDK bypasses Firestore rules, so server endpoints must still verify Firebase ID tokens and enforce all authorization checks themselves. Do not relax or deploy these rules until the replacement API and emulator tests are ready.


## Firebase Authentication and Vercel identity foundation (isolated)

The branch now contains an opt-in Firebase Authentication client adapter and a Vercel identity verification endpoint:

- `src/lib/firebaseAuth.js` wraps Firebase email/password registration and sign-in, Google popup sign-in, email verification, password reset, auth-state observation, sign-out, and Firebase ID-token retrieval.
- `api/_lib/firebaseAuth.js` verifies Firebase ID-token signatures locally with Node's crypto module and Google's rotating Secure Token public certificates. It enforces RS256, the configured project audience, the Firebase issuer, subject, expiry, issued-at/auth-time bounds, and Firebase token claims; it refreshes certificates once when an unknown key ID is encountered.
- `POST /api/auth/session` accepts an `Authorization: Bearer <Firebase ID token>` header and returns `{ authenticated: true, user: { uid, email, emailVerified, displayName } }` only after cryptographic signature and claim verification. It is an identity probe, not an authorization grant for any data.
- `api/_lib/firebaseAuth.test.js` covers a valid signed token, wrong-project audience, tampered signature, and fail-closed project configuration. Run it with `npm run test:auth`.

The verifier fetches Google's public signing certificates and needs no Firebase Web API key or service-account private key. Configure `FIREBASE_PROJECT_ID=shelflife-tbr-9754d` in the Vercel Preview environment before exercising the endpoint. The public certificate endpoint is cached according to Google's `Cache-Control` lifetime. The verifier does not check token revocation or disabled-user state; sensitive operations requiring that guarantee should use Firebase Admin SDK verification with revocation checking, backed by a server-only credential. Never put service-account JSON or private keys in `VITE_*` variables or commit them.

### Authentication parity gate

The existing Base44 screens currently support Google and Facebook sign-in, email/password login, and a six-digit email OTP during registration. Password recovery uses a Base44 reset-token flow. The isolated Firebase adapter currently supports Google and email/password, but uses Firebase email-verification links and Firebase password-reset links; it does not yet implement Facebook sign-in or the existing six-digit OTP experience. The current `ResetPassword` screen also expects the Base44 `token` parameter, not Firebase's `oobCode` action-code flow.

Do not wire Firebase into `AuthContext` or replace the login/register/reset screens until the owner chooses whether to preserve Facebook and six-digit OTP, or explicitly approves an equivalent UX change. Implement and test every selected provider and email-action flow first, then validate account linking and stable UID mapping against existing Base44 users.

**The current app is deliberately not switched:** `src/lib/AuthContext.jsx`, `src/api/base44Client.js`, and the Base44 Vite plugin remain unchanged. The new Firebase adapter is not wired into login screens or the live auth provider. This avoids locking existing users out before account migration, provider setup, and Android compatibility tests are complete.

Before using the new adapter in a preview:
1. In Firebase Console > Authentication > Sign-in method, explicitly enable Email/Password and Google only if those are the intended ShelfLife providers.
2. Add the preview and production hostnames to Authentication authorized domains only when those domains are actually selected.
3. Confirm the Google OAuth consent screen/client configuration and authorized domains for the chosen hostnames.
4. Set the two server environment variables in the Vercel **Preview** environment first; do not change Production.
5. Test registration, verification email, login, Google popup, reset, session restore, sign-out, expired token, and wrong-project token cases.

No Firebase provider has been enabled by this code change, no Vercel environment variable has been set, and no production auth/session flow has changed. Firebase Admin/Firestore data access and per-feature authorization are still separate implementation work; this endpoint does not authorize Firestore reads/writes or replace the Base44 user/profile mapping.


### Existing-account profile bridge — next gated implementation

See [`firebase-auth-profile-bridge.md`](./firebase-auth-profile-bridge.md) for the concrete linking contract. It defines why Firebase UID cannot be treated as the existing Base44 user ID, why email matching is not safe account proof, the server-only bidirectional identity mapping, and the API/test gates required before the login UI can change.

The owner reports that Email/Password and Google providers have now been enabled in Firebase Authentication. This is owner-reported setup, not independently verified through Firebase Console access. Provider enablement alone does not link existing accounts or make Firebase the source of ShelfLife profiles.

**Implementation is blocked at the trusted profile-bridge boundary:** this repository has no confirmed Firestore identity store, no approved Firebase Admin SDK server credential mechanism, and no proven Vercel-side Base44-session verification path. Do not invent or infer those capabilities. The correct next action is to provision/approve an isolated Preview identity store and a server-only identity mechanism, then implement and test the link resolver. Until then, keep Base44 auth and all login/register/reset screens unchanged.
