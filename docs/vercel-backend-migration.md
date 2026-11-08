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


## Firebase project discovery (owner-provided)

- Firebase project ID supplied by the owner: `shelflife-511306`.
- The owner currently receives a permission error when opening Firebase Console, including in a private browser session and over mobile data; Google Search itself opens normally.
- Treat Firebase project access and Workspace policy/permissions as **unverified** until the owner can open the project or an authorized project administrator confirms access.
- Do not create resources, change IAM, deploy Firebase rules, or assume Firebase is approved as the primary database/auth provider based on the project ID alone.
- Once access is restored, inspect the existing project configuration and billing before selecting Firebase Auth/Firestore/Storage roles in the migration. Preserve any existing Storage use for book covers until parity and rules are verified.


### Firebase configuration status

The owner supplied Firebase project ID `shelflife-511306`. A starter `.env.example` now documents the Vite client configuration keys, with the supplied project ID prefilled. This is a template only: it does not configure the deployed app, create Firebase resources, or establish project access. The remaining web-app values must be confirmed from the existing Firebase project. Do not invent them or place Admin SDK service-account credentials in any `VITE_*` variable; Vite variables are shipped to the browser.
