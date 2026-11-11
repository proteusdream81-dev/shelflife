# Firebase migration coverage register

Last reviewed: 11 November 2026  
Working branch: `migration/firebase-profile-bridge`  
Status: engineering inventory only; no production cutover.

## Migration slices present in this branch

| Capability | Firebase implementation in branch | Current limitation |
|---|---|---|
| Firebase authentication | ID-token verification, verified-email checks, revocation-aware auth helper, profile endpoint | Main AuthContext/login/register/reset flows still use Base44 |
| Legacy account linking | Dual-session proof endpoint and preview UI; dry-run does not access Firestore | Identity-link writes remain gated; no independently verified identity manifest |
| Reader profiles | Owner profile resolver and allowlisted `GET /api/me` | Existing profiles have not been migrated or validated |
| Books and shelves | Normalized Firestore collection/read/write/delete APIs, optimistic concurrency, client adapter | Existing production data has not been imported; main Books/Shelves UI still uses Base44 |
| Social graph | Follow/request/accept/remove/block/unblock and paginated relationship reads | Main Friends/reading-circle UI still uses Base44 |
| Book groups and chat | Group directory, membership/invites, roster and paginated chat APIs | Main groups/chat UI still uses Base44; full historical actor-room export remains outstanding |
| Sharing | Public share resolution, shared-with-me feed, selected-recipient permissions | Main SharePanel/public sharing UI still uses Base44 |
| Comments and moderation | Comment list/create/delete/report and moderation review APIs | Main comments/moderation UI still uses Base44 |
| Cover storage | Private R2 Worker source, Firebase token validation, owner-scoped object keys, signed reads, upload validation | Worker is not deployed; preview bucket is empty; writes disabled |
| Migration execution | Dry-run planner and bounded create-only importer with immutable target binding and conflict preflight | No production import has occurred; source snapshot, identity manifest, rehearsal and rollback remain outstanding |
| Catalogue search and OCR | Browser catalogue search and local cover OCR validation | Does not establish parity with every legacy enrichment/catalogue function |

## Legacy Base44 function inventory

The following function entrypoints exist in the legacy source. The labels below are migration tracking, not a claim that their full behaviour has been ported.

| Legacy function | Migration disposition |
|---|---|
| `accountDeletion` | Not migrated; requires a separate verified identity, retention and destructive-action design |
| `authorReleases` | Not yet parity-verified |
| `bookCovers` | R2 storage is a separate capability; catalogue cover lookup parity not yet verified |
| `bookFormats` | Not yet parity-verified |
| `bookGroups` | Group directory/membership APIs exist; full legacy function parity not yet verified |
| `bookSeries` | Not yet parity-verified |
| `comments` | Backend API slice implemented; UI cutover outstanding |
| `confirmWaitlistTester` | Not migrated; email confirmation workflow outstanding |
| `discoverBookClubs` | Not yet parity-verified |
| `enrichBooks` | Not yet parity-verified; preserve edited-field protections and source attribution |
| `joinWaitlist` | Not migrated; waitlist signup and consent workflow outstanding |
| `nearbyPlaces` | Not yet parity-verified |
| `readingCircle` | Social graph APIs exist; full legacy function parity and UI cutover outstanding |
| `releaseReminders` | Not migrated; Google Calendar event lifecycle and authorization outstanding |
| `searchBooks` | Browser catalogue search exists; upstream catalogue/provider parity not yet verified |
| `testerOutageNotice` | Not migrated; email delivery and recipient consent process outstanding |
| `weeklyTrending` | Not migrated; scheduled-job replacement and data-source parity outstanding |

## Verified preview and CI state — 11 November 2026

- Draft PR #28 is open, unmerged and targets `migration/firestore-normalized-v1`, not `main`.
- Latest PR head: `69c40814fc4bd3aade6e3fc37885cb2c3adb2a71`.
- GitHub Actions Build validation run [#1119](https://github.com/proteusdream81-dev/shelflife/actions/runs/42987017302) passed all 19 build-job steps on the latest PR head. Runs [#1115](https://github.com/proteusdream81-dev/shelflife/actions/runs/42986872868) and [#1107](https://github.com/proteusdream81-dev/shelflife/actions/runs/42986054863) also passed all 19 steps on their respective earlier code heads.
- Migration planner integrity checks now quarantine unsupported explicit Follow and GroupInvite statuses, unsupported explicit Book/Shelf sharing audiences, self-follow, self-block and self-invitation records. Missing legacy status/audience values retain only the defaults documented in the source entity schemas. Regression tests cover these cases.
- Public shelf-share resolution now returns a safely normalized owner display name; a regression test covers the former undefined-variable failure.
- The WIF smoke-test cleanup is hardened with a unique per-invocation ownership token, read-back ownership verification and Firestore update-time delete preconditions. A regression test confirms an existing document is not deleted when create returns `ALREADY_EXISTS`.
- Identity-link creation commits forward and reverse create-only mappings atomically.
- Latest recorded Vercel Preview deployment is READY at `https://shelflife-bise93uhz-shelf-lufe.vercel.app`. Later deployment attempts encountered the account's daily deployment limit; avoid unnecessary redeployments.
- Branch-scoped Vercel read-back confirms browser and server Firebase bindings target the non-production project `shelflife-tbr-dev` (project number `1011106075373`).
- The protected `/firebase-link-preview` route returned HTTP 200. `GET /api/health` returned 200. Unauthenticated POST requests to the identity-link and WIF smoke-test endpoints returned 401, confirming fail-closed routing/authentication only.
- The WIF smoke-test has not yet completed with a valid Firebase user session. A successful runtime Workload Identity Federation exchange is therefore not established.
- Earlier validation recorded 325 automated tests passed; ESLint, Vercel prebuild WIF check and Vite build passed. TypeScript still reports 501 diagnostics across 88 files; the recorded diagnostics do not include the changed JS/JSX files.
- Preview feature flags are branch-scoped. General Firestore migration writes, identity-link writes and cover Worker writes remain disabled.
- No production user data or identity links have been written. No production deployment, import, Firestore rule change, R2 upload, Worker deployment, merge or republish has occurred. Production remains untouched.

## Remaining release gates

1. Complete the protected Preview dual-session identity proof and isolated Firestore WIF smoke test with valid Base44 and Firebase sessions.
2. Capture a protected, consistent Base44 source snapshot while writes are quiesced.
3. Independently verify all legacy-to-Firebase identity mappings. Never map accounts by email equality alone; quarantine unmatched identities.
4. Complete and validate the retained BookGroupRoom actor export. Its current design is limited to the latest 300 retained messages per enumerable room and is not atomic across rooms; live Base44 runtime validation and enforced write quiescence remain required.
5. Rehearse the create-only importer, authorization boundaries, private sharing, independent restore and rollback in non-production.
6. Complete app-wide AuthContext/data-adapter and UI cutover, including parity for the legacy functions listed above.
7. Obtain explicit production release approval before production deployment, data import, Firestore rule changes, R2 upload or republishing.

A passing CI build or READY Preview deployment is not evidence that production migration, data recovery or rollback is complete.
