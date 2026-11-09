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

- One Base44 actor: `BookGroupRoom` for per-group live presence and bounded chat history (40 readers max, 120 message history page, 300 retained messages, 1,000-character body). Actor state is not included in normal entity exports and needs a separate history export.
- One Base44 agent: `book_club_host`, using BookGroup, GroupInvite, bookGroups, discoverBookClubs and releaseReminders.
- Two connector configuration files in source: Google Sheets and Instagram.
- Ten email templates: AccountDeletionCode, ConfirmTesterEmail, EnquiryReply, FoundingTesterWelcome, Newsletter, ProductUpdate, ShelfComment, TesterOutageNotice, WeeklyTrendingMatches and Welcome.
- Google Calendar is a per-reader OAuth dependency for releaseReminder sync. The app-level Google Workspace connector was previously reported expired; individual reader OAuth grants must be rechecked. The source `wipeAccount` helper does not visibly delete ReleaseReminder rows or their external Calendar events.
- Earlier app connector status checks reported Instagram Business, Google Search Console, GitHub and Sentry active; Gmail and Google Workspace expired; Google Sheets disconnected. The current Base44 integration workspace is out of integration credits, so these statuses could not be reverified in this pass.
- Catalogue providers include Google Books, Open Library, Hardcover GraphQL and Project Gutenberg/Gutendex. Nearby places use Photon and OpenStreetMap Overpass.
- `base44/workflows/WeeklyTrendingMatches.jsonc` schedules `weeklyTrending` every Monday at 08:00 `Australia/Sydney` (`0 8 * * 1`) and sends email only when new matches exist. `TesterOutageNotice.jsonc` is a one-off scheduled for 25 October 2026 13:27 UTC (past; do not recreate). These triggers must be preserved/retired intentionally, not guessed.
- GitHub repository contains one Build validation workflow. The application schedule definitions are in `base44/workflows`, not GitHub Actions.

## 5. Privacy and feature-parity requirements

The target must preserve: private notes; private shelves; circle and selected-recipient sharing; share-link revocation; hidden profiles; accepted versus pending follows; blocks in both directions; public/private BookGroups; invite-only private membership; group-local removed-member bans; comments derived from underlying share permissions; moderation reports; content warning and cover-hiding preferences; Google Calendar event IDs; account deletion; waitlist consent and confirmation.\n\nThe current `base44/shared/accountWipe.ts` removes core library and relationship rows but does not visibly remove ReleaseReminder/Calendar events, Comment rows where the user is author or target owner, Report rows where the user is reporter/author, or actor room history when a group is deleted. Signed-in deletion also does not visibly clear associated AccountDeletionRequest rows. These are explicit parity gaps to close in the new deletion workflow; moderation evidence may require retention/anonymisation rather than unconditional deletion.

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
5. **Backup/import rehearsal:** export a protected, consistent Base44 snapshot including a separate BookGroupRoom actor-history export; dry-run allowlisted importer; deterministic IDs; create-only behaviour; count/hash/reference reconciliation; quarantine unknown owners; confirm username uniqueness, hashed share-link tokens, Calendar event references and group membership; test restore and rollback. PR #23 includes an in-memory dry-run planner and CLI; it cannot apply writes.
6. **Production cutover:** separate approval, freeze/delta strategy, final reconciliation, monitored release and rollback threshold.

## 8. Immediate implementation order

1. Build one shared Firebase/WIF server auth layer and normalized `users/{uid}/books` API.
2. Add shelves and multi-shelf support; then groups, relationships, blocks, share links and comments.
3. Add verified account linking and two-account tests.
4. Port all remaining backend functions, agent, actor, Calendar and email behavior.
5. Build the migration exporter/importer and perform a non-production rehearsal.
6. Present a separately reviewed Production cutover plan.

No data import, Production IAM change, Firestore rules relaxation, app-wide Firebase auth switch, hosting change or Base44 shutdown has been performed as part of this work. The source-level migration planner is a preparation tool only: it requires one-to-one independently verified UID mappings, a consistent snapshot and actor history before it marks a plan ready; it never writes to Firestore.
