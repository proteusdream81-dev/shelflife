# ShelfLife architecture reconciliation

**Decision:** Firestore schema v1 accepted as the target architecture on 10 November 2026.  
**Implementation state:** Staged migration only. No Production cutover or data import has been performed.

## 1. Architecture decision

ShelfLife will keep its React/Vite client and Vercel hosting while moving authentication and application data to Firebase Authentication and Cloud Firestore.

The permanent data model is normalized around Firebase UIDs:
- User-owned records live under `users/{uid}` subcollections.
- Community objects (groups, relationships, blocks, comments) live in dedicated top-level collections.
- Privileged data access stays behind Vercel API routes that verify Firebase tokens and use keyless Vercel OIDC → Google Workload Identity Federation.
- Client Firestore rules remain deny-all while server APIs enforce access.
- Base44 remains the legacy source and rollback reference until migration gates pass.
- Firebase Storage is deferred pending cost and file-ownership review.

The complete accepted path contract, source mappings, permission invariants and migration rules are in [Firestore schema v1](firestore-schema-v1.md).

## 2. Verified current state

| Area | Current evidence | Decision |
|---|---|---|
| Client | React/Vite; Base44 SDK remains in `package.json` | Keep client; migrate API dependencies by feature |
| App authentication | `src/lib/AuthContext.jsx` still calls Base44 settings and `base44.auth.me()` | Firebase Auth is not yet the app-wide auth provider |
| Hosting | Vercel project and Preview deploys | Retain Vercel |
| Firebase | Project `shelflife-tbr-9754d` and Preview auth/WIF foundation exist | Preview only until verified |
| Firestore | PR #21 includes REST read adapter and legacy owner-only preview endpoint | Migration bridge only; not canonical data layout |
| Firestore client rules | Deny-all in migration design | Keep closed until rule/emulator tests |
| Legacy app | Base44 entity schemas, 18 backend functions, one actor and one agent exist | Do not disable until parity and rollback verified |
| Migration | No import performed | Data remains on Base44 source |
| Production | No auth/data/hosting cutover verified | No production state change authorized by this decision |

## 3. Live Base44 source audit

The connected ShelfLife Base44 app was queried on 10 November 2026 with record-ID-only selections. The live count materially differs from earlier notes that had recorded one Book and one Shelf. The current counts are:

| Entity | Records |
|---|---:|
| Book | 3,224 |
| Shelf | 52 |
| User | 21 |
| BookGroup | 2 |
| Follow | 11 |
| Comment | 5 |
| ReleaseReminder | 3 |
| BookSearchCache | 976 |
| ClubSearchCache | 7 |
| PlacesCache | 7 |
| RateLimitHit | 311 |
| ReaderSearch | 26 |
| Waitlist | 2 |
| WaitlistAttempt | 6 |
| AccountDeletionRequest, Block, GroupInvite, Report | 0 each |
| **Total across 18 entities** | **4,653** |

Owner audit: 9 distinct legacy IDs own Book records, 17 own Shelf records, 2 own ReleaseReminder records, 1 owns BookGroups, 5 distinct follower IDs occur in Follow records and 2 authors occur in Comment records. The app has 21 User records. This is a multi-user migration and every source owner must be mapped and reconciled.

These counts are paginated and non-transactional, not a backup or a consistent point-in-time export. The previous Firestore zero-document check across six collections was not repeated during this audit. Firestore population therefore remains unverified.

## 4. Complete source inventory

### 18 entity schemas
`AccountDeletionRequest`, `Block`, `Book`, `BookGroup`, `BookSearchCache`, `ClubSearchCache`, `Comment`, `Follow`, `GroupInvite`, `PlacesCache`, `RateLimitHit`, `ReaderSearch`, `ReleaseReminder`, `Report`, `Shelf`, `User`, `Waitlist`, `WaitlistAttempt`.

### 18 backend functions
| Function | Responsibility |
|---|---|
| `accountDeletion` | Signed-in and email-code account deletion workflows |
| `authorReleases` | Catalogue lookup for release dates by authors in a reader's library |
| `bookCovers` | Alternate edition cover lookup |
| `bookFormats` | Edition/format lookup and cache |
| `bookGroups` | Group join/leave, invite/accept/decline, member removal and closure |
| `bookSeries` | Series name and volume lookup |
| `comments` | Shared shelf/book comment threads and reports |
| `confirmWaitlistTester` | Tester confirmation and onboarding |
| `discoverBookClubs` | Discovery of real-world book clubs from public listings |
| `enrichBooks` | Imported-book catalogue enrichment |
| `getSharedShelf` | Anonymous bearer-link projection for shared books/shelves |
| `joinWaitlist` | Public waitlist signup, confirmation emails and throttling |
| `nearbyPlaces` | Nearby libraries/bookshops via Photon and Overpass |
| `readingCircle` | Reader discovery, follow relationships, blocks, usernames and shared libraries |
| `releaseReminders` | Per-user Google Calendar release-event sync |
| `searchBooks` | Book catalogue search, merging results and rate limits |
| `testerOutageNotice` | Admin-only tester outage email with dry-run support |
| `weeklyTrending` | Monday admin/workflow scan and weekly digest |

### Additional runtime and communications inventory

- One Base44 actor: `BookGroupRoom` for per-group live presence and bounded chat history.
- One Base44 agent: `book_club_host`, using BookGroup, GroupInvite, bookGroups, discoverBookClubs and releaseReminders.
- Two connector configuration files in source: Google Sheets and Instagram.
- Ten email templates: AccountDeletionCode, ConfirmTesterEmail, EnquiryReply, FoundingTesterWelcome, Newsletter, ProductUpdate, ShelfComment, TesterOutageNotice, WeeklyTrendingMatches and Welcome.
- Google Calendar is a per-reader OAuth dependency for releaseReminder sync. The app-level Google Workspace connector was reported expired in the live connector check.
- Live app connector states: Instagram Business, Google Search Console, GitHub and Sentry active; Gmail and Google Workspace expired; Google Sheets disconnected.
- Catalogue providers include Google Books, Open Library, Hardcover GraphQL and Project Gutenberg/Gutendex. Nearby places use Photon and OpenStreetMap Overpass.
- `weeklyTrending` is described in source as a Monday workflow task, but no scheduler definition was found in the inspected GitHub repository tree. The live Base44 Workflow configuration still needs inspection before replacing the schedule.
- GitHub repository contains one Build validation workflow and no scheduled GitHub workflow.

## 5. Privacy and feature-parity requirements

The target must preserve: private notes; private shelves; circle and selected-recipient sharing; share-link revocation; hidden profiles; accepted versus pending follows; blocks in both directions; public/private BookGroups; invite-only private membership; member removal; comments derived from underlying share permissions; moderation reports; content warning and cover-hiding preferences; Google Calendar event IDs; account deletion; waitlist consent and confirmation.

Do not port the current owner-only Preview rule as the final authorization model. It is only a safe first migration slice.

## 6. PR decisions

| PR | Decision |
|---|---|
| #13 | Historical migration foundation |
| #17 | Firebase readiness/rules/Storage reference; revalidate live settings |
| #18 | Isolated Firebase Auth Preview smoke test |
| #19 | Revocation-aware Firebase token verification; shared security foundation |
| #20 | Its per-UID books path aligns with Firestore v1 but is only a narrow books endpoint; consolidate with shared WIF/auth before merge |
| #21 | Explicit legacy identity mapping and owner-filtered top-level reads; migration audit bridge only, not the canonical app data API |
| #22 | Architecture/schema decision and inventory; documentation only |

PR #20 and #21 must not be merged independently as currently implemented. Use the shared WIF/token verification foundation and implement the final per-UID subcollection contract. Keep the legacy owner-filtered route isolated to controlled migration verification.

## 7. Migration gates

1. **Schema:** this target architecture is accepted. Implement the canonical paths and field projections.
2. **Identity:** verify dual-session linking or equivalent independent proof for every relevant Base44 user. No email-only links. Live owner audit found 9 Book owners and 17 Shelf owners across 21 User records.
3. **Security:** verify live WIF binding and IAM; remove broad project-level Datastore User grant where present; keep Firestore client rules deny-all; add emulator tests.
4. **Parity:** test two-account ownership, follow and block behavior, all share modes, group invites/removal, comments, waitlist, Calendar sync and account deletion.
5. **Backup/import rehearsal:** export protected Base44 snapshot; dry-run allowlisted importer; deterministic IDs; create-only behavior; count/hash/reference reconciliation; quarantine unknown owners; test restore and rollback.
6. **Production cutover:** separate approval, freeze/delta strategy, final reconciliation, monitored release and rollback threshold.

## 8. Immediate implementation order

1. Build one shared Firebase/WIF server auth layer and normalized `users/{uid}/books` API.
2. Add shelves and multi-shelf support; then groups, relationships, blocks, share links and comments.
3. Add verified account linking and two-account tests.
4. Port all remaining backend functions, agent, actor, Calendar and email behavior.
5. Build the migration exporter/importer and perform a non-production rehearsal.
6. Present a separately reviewed Production cutover plan.

No data import, Production IAM change, Firestore rules relaxation, app-wide Firebase auth switch, hosting change or Base44 shutdown has been performed as part of this work.
