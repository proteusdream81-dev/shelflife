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
| Sharing | Public share resolution, shared-with-me feed, selected-recipient permissions; Share page tries Firestore-native links first and falls back to Base44 only for unknown Firebase tokens; public resolver enforces owner `hideCovers` and omits Firebase UID | Main SharePanel/public sharing UI still uses Base44; Firebase-native public-share discussions are temporarily disabled until token-aware Firebase comment access is implemented; legacy links retain Base44 discussions |
| Comments and moderation | Comment list/create/delete/report and moderation review APIs | Main comments/moderation UI still uses Base44 |
| Cover storage | Private R2 Worker source, Firebase token validation, owner-scoped object keys, signed reads, upload validation | Worker is not deployed; preview bucket is empty; writes disabled |
| Migration execution | Dry-run planner and bounded create-only importer with immutable target binding and conflict preflight | No production import has occurred; source snapshot, identity manifest, rehearsal and rollback remain outstanding |
| Catalogue search, enrichment, formats, series, author releases, covers and OCR | Browser Google Books/Open Library search and guarded enrichment; direct Open Library format, edition-series, batched author-release and edition-cover lookups; local cover OCR validation | Main enrichment paths avoid the legacy Base44 function call, but Hardcover-specific metadata/ratings and full upstream provider parity remain outstanding |

## Legacy Base44 function inventory

The following function entrypoints exist in the legacy source. The labels below are migration tracking, not a claim that their full behaviour has been ported.

| Legacy function | Migration disposition |
|---|---|
| `accountDeletion` | Not migrated; requires a separate verified identity, retention and destructive-action design |
| `authorReleases` | Release Calendar now reads the existing Base44 Book list and performs bounded, batched Open Library release lookups directly in the browser; day-precision date parsing, 24-author cap, 6-request batches, date window and earliest-title deduplication are covered by tests. Base44 remains the active Book/Shelf store until the data cutover. |
| `bookCovers` | CoverPicker now reads Google Books cover imagery and Open Library edition cover IDs directly in the browser; Amazon cover fallback remains client-side. Hardcover-specific cover discovery is not ported. User-uploaded cover storage remains a separate R2/Worker capability. |
| `bookFormats` | Direct Open Library edition-format lookup is used by the browser; legacy function invocation removed from the format picker |
| `bookGroups` | Group directory/membership APIs exist; full legacy function parity not yet verified |
| `bookSeries` | Direct Open Library edition-series lookup now replaces the legacy function invocation in BookDetailDialog; series metadata persistence remains on the active Base44 book record until data/UI cutover |
| `comments` | Backend API slice implemented; UI cutover outstanding |
| `confirmWaitlistTester` | Not migrated; email confirmation workflow outstanding |
| `discoverBookClubs` | Not yet parity-verified |
| `enrichBooks` | ImportLibraryDialog and ReleaseDetailDialog now use direct Google Books/Open Library enrichment with exact-ISBN or title/author confidence checks, ASIN source labelling and four-book concurrency batches. Import metadataPatch still preserves existing edited/non-empty fields. Hardcover-specific metadata, ratings and cover provider parity are not ported. |
| `getSharedShelf` | The public Share page now attempts the Firebase `/api/share/:token` resolver first when Firebase is configured, normalizes its response to the existing page contract, and falls back to legacy Base44 `getSharedShelf` only when Firebase returns 404 (pre-migration/unknown token). Genuine Firebase 5xx failures are not masked by fallback. Existing Base44 tokens and their discussions remain supported. Firebase-native public-share discussions are explicitly hidden until a token-authorized Firebase comments path is implemented. |
| `identifyBook` | `ScanBook` now tries on-device Tesseract OCR and direct Google Books/Open Library search first; it calls the existing hosted `identifyBook` function only when OCR/catalogue matching fails or OCR cannot load. The original function source is still absent from this branch, so this remains a compatibility fallback rather than a full parity claim. Five tests cover direct match, catalogue miss, OCR failure, provider failure and empty OCR. |
| `joinWaitlist` | Not migrated; waitlist signup and consent workflow outstanding |
| `nearbyPlaces` | Not yet parity-verified |
| `readingCircle` | Social graph APIs exist; full legacy function parity and UI cutover outstanding |
| `releaseReminders` | Not migrated; Google Calendar event lifecycle and authorization outstanding |
| `searchBooks` | Browser catalogue search exists; upstream catalogue/provider parity not yet verified |
| `testerOutageNotice` | Not migrated; email delivery and recipient consent process outstanding |
| `weeklyTrending` | Not migrated; scheduled-job replacement and data-source parity outstanding |

## Verified preview and CI state — 11 November 2026

- Draft PR #28 is open, unmerged and targets `migration/firestore-normalized-v1`, not `main`.
- Latest code head: `43838552af46a84a23ce4430bb99d12a3abb5407` (Firebase-first public-share compatibility and OCR-first cover scanning). The discussion-visibility guard and documentation reconciliation are recorded in the PR history below.
- GitHub Actions Build validation run [#1129](https://github.com/proteusdream81-dev/shelflife/actions/runs/43011636584) passed all 19 build-job steps on code head `2a4dd9b`. Run [#1131](https://github.com/proteusdream81-dev/shelflife/actions/runs/43011904810) passed all 19 steps on the latest PR head `2bf4173`. Runs [#1127](https://github.com/proteusdream81-dev/shelflife/actions/runs/43010828069), [#1125](https://github.com/proteusdream81-dev/shelflife/actions/runs/43009871334) and [#1123](https://github.com/proteusdream81-dev/shelflife/actions/runs/43008457561) also passed all 19 steps on their respective preceding code heads.
- GitHub Actions Build validation run [#1133](https://github.com/proteusdream81-dev/shelflife/actions/runs/43013000179) passed all 19 steps on parent PR head `b251fca`; run [#1135](https://github.com/proteusdream81-dev/shelflife/actions/runs/43014342298) passed all 19 steps on latest PR head `d8463ca`, including the new import-cover regression tests.
- Runs [#1138](https://github.com/proteusdream81-dev/shelflife/actions/runs/43015800975) and [#1139](https://github.com/proteusdream81-dev/shelflife/actions/runs/43015809623) both passed all 19 steps on public-share privacy code head `a114920`; runs [#1140](https://github.com/proteusdream81-dev/shelflife/actions/runs/43015877831) and [#1141](https://github.com/proteusdream81-dev/shelflife/actions/runs/43015884406) both passed all 19 steps on the subsequent documentation refresh `b79263a`.
- Build validation runs [#1144](https://github.com/proteusdream81-dev/shelflife/actions/runs/43019257844) and [#1145](https://github.com/proteusdream81-dev/shelflife/actions/runs/43019266243) passed all 19 steps on code head `4383855`. Documentation refresh `6e36634` passed all 19 steps in runs [#1146](https://github.com/proteusdream81-dev/shelflife/actions/runs/43019540398) and [#1147](https://github.com/proteusdream81-dev/shelflife/actions/runs/43019547388). Discussion-visibility guard commit `090dad0` passed all 19 steps in run [#1148](https://github.com/proteusdream81-dev/shelflife/actions/runs/43019919953). Documentation-only reconciliation commit `7d621de` passed all 19 steps in runs [#1150](https://github.com/proteusdream81-dev/shelflife/actions/runs/43020258176) and [#1151](https://github.com/proteusdream81-dev/shelflife/actions/runs/43020266173).
- A fresh local validation on the clean PR checkout passed all 357 test executions across the 13 validation scripts (some test files run in more than one script), ESLint and the Vite production build. The local build emitted the expected warning that `VITE_BASE44_APP_ID` was not set; this build does not prove live Base44 connectivity.
- `npm run typecheck` remains failing: 532 diagnostics across 97 files in this local environment after the import and release-dialog fixes. The issues are broad JS/JSX component typing mismatches; this was recorded rather than hidden with blanket suppression.
- Fixed an import-enrichment defect: `metadataPatch` now consumes the edition-cover candidates returned by direct catalogue enrichment, fills a missing primary cover and empty alternate-cover list with HTTPS candidates, and preserves existing reader-selected cover metadata. Four regression tests were added to the catalogue test script and CI step.
- Public share privacy parity: unauthenticated book and shelf shares now apply the owner's `hideCovers` preference to both `cover_url` and `alt_covers`, and public responses no longer expose the owner's stable Firebase UID. Two regression tests cover book and shelf share redaction.
- Public Share page compatibility: Firebase-native share tokens are now resolved through `/api/share/:token` first and normalized for the existing page; a 404 falls back to Base44 `getSharedShelf` so pre-migration tokens keep working. Firebase 5xx errors are surfaced rather than silently hidden by the legacy fallback. Firebase-native share pages do not render the legacy comments panel because its Base44 resolver cannot authorize Firestore share tokens; a clear discussion-unavailable notice is shown instead.
- Cover-photo scan now prefers local on-device OCR plus direct Google Books/Open Library matching and uses the hosted `identifyBook` function only as a fallback when direct recognition misses or fails. Five regression tests cover the fallback contract.
- Migration planner integrity checks now quarantine unsupported explicit Follow and GroupInvite statuses, unsupported explicit Book/Shelf sharing audiences, self-follow, self-block and self-invitation records. Missing legacy status/audience values retain only the defaults documented in the source entity schemas. Regression tests cover these cases.
- Public shelf-share resolution now returns a safely normalized owner display name; a regression test covers the former undefined-variable failure.
- The WIF smoke-test cleanup is hardened with a unique per-invocation ownership token, read-back ownership verification and Firestore update-time delete preconditions. A regression test confirms an existing document is not deleted when create returns `ALREADY_EXISTS`.
- Identity-link creation commits forward and reverse create-only mappings atomically.
- Latest recorded Vercel Preview deployment is READY at `https://shelflife-bise93uhz-shelf-lufe.vercel.app`. Later deployment attempts encountered the account's daily deployment limit; avoid unnecessary redeployments.
- Branch-scoped Vercel read-back confirms browser and server Firebase bindings target the non-production project `shelflife-tbr-dev` (project number `1011106075373`).
- The protected `/firebase-link-preview` route returned HTTP 200. `GET /api/health` returned 200. Unauthenticated POST requests to the identity-link and WIF smoke-test endpoints returned 401, confirming fail-closed routing/authentication only.
- The latest READY Vercel Preview build log confirms a successful build-time Vercel OIDC → Google Workload Identity Federation token exchange to the dev-only service account. The protected runtime Firestore create/read/delete smoke test has not yet completed with a valid Firebase user session; Firestore IAM access is still unverified.
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
