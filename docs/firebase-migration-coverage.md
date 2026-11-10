# Firebase migration coverage register

Last reviewed: 10 November 2026  
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
| Book groups and chat | Group directory, membership/invites, roster and paginated chat APIs | Main groups/chat UI still uses Base44; full historical actor-room export is outstanding |
| Sharing | Public share resolution, shared-with-me feed, selected-recipient permissions | Main SharePanel/public sharing UI still uses Base44 |
| Comments and moderation | Comment list/create/delete/report and moderation review APIs | Main comments/moderation UI still uses Base44 |
| Cover storage | Private R2 Worker source, Firebase token validation, owner-scoped object keys, signed reads, upload validation | Worker is not deployed; preview bucket is empty; writes disabled |
| Migration execution | Dry-run planner and bounded create-only importer with immutable target binding and conflict preflight | No source snapshot, non-production target, rehearsal or import has occurred |
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

## Operational gates

1. Provision a separate non-production Firebase project and dedicated WIF service identity. The current Vercel Preview browser and server Firebase settings target the production project.
2. Validate the current Vercel Preview build and API runtime against the non-production project. Source now has 9 API function entrypoints, within the Vercel Hobby limit of 12; current-head Preview runtime is not yet validated.
3. Obtain a protected, consistent Base44 source snapshot while writes are quiesced.
4. Independently verify each legacy-to-Firebase identity mapping. Do not map by email equality.
5. Complete the actor-room history export and pagination-boundary checks.
6. Rehearse the create-only importer, authorization, private sharing, restore and rollback in non-production.
7. Complete the app-wide AuthContext/data-adapter and UI cutover only after feature parity and restore gates pass.
8. Obtain explicit production release approval before deployment, data import, Firestore rule changes, R2 upload or republishing.

## Current verified engineering state

- GitHub Actions Build validation run #1059 passed on commit `ecd7d9053155d8b9aee5f85349a11e0bb085bdf4`.
- Draft PR #28 remains open and unmerged; its base is `migration/firestore-normalized-v1`, not `main`.
- No production identity links, profiles, data imports, Firestore rule changes, R2 uploads, Worker deployment, production deployment or republish have occurred.
- ShelfLife remains unpublished/offline.
