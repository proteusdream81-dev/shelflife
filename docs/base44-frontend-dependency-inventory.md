# ShelfLife Base44 frontend dependency inventory

## Why this inventory exists

The Vercel migration cannot be completed by copying the 19 Base44 function handlers alone. The React client also uses the Base44 SDK directly for identity, profile updates, entity CRUD, and function calls. This inventory groups the known frontend touchpoints into migration domains so that the replacement can be implemented and tested feature-by-feature.

This is a source-level inventory based on the repository's current default-branch code search. Search results identify matching source files, not a mathematically exact count of every call site; patch files and generated/vendor content are not treated as application dependencies.

## Frontend migration domains

| Domain | Representative source files | Replacement contract required |
|---|---|---|
| Authentication and sessions | `src/lib/AuthContext.jsx`, `src/pages/Login.jsx`, `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `OAuthConsent.jsx` | Sign-in, registration, email verification/OTP, Google sign-in, password reset, session restore, logout, and stable user-ID mapping |
| User profile and preferences | `src/pages/Settings.jsx`, `src/components/settings/UsernameCard.jsx`, `src/components/tbr/FoundingTesterBanner.jsx`, `src/pages/Home.jsx` | Read/update current profile, username claims, privacy settings, tester opt-ins/dismissals, and other user preferences |
| Books and shelves | `src/lib/bookStore.js`, `src/pages/Home.jsx`, `src/pages/AuthorPage.jsx`, `src/pages/ReaderLibrary.jsx`, `src/pages/ReleaseCalendar.jsx`, `src/components/tbr/ShelfForm.jsx`, `ShelfSection.jsx`, `AddBookDialog.jsx`, `BookDetailDialog.jsx`, `ImportLibraryDialog.jsx`, `src/components/settings/ImportCard.jsx` | Book and shelf CRUD, filtered/paginated reads, counts, import, deduplication, ownership, and transactional shelf moves/deletes |
| Social graph and reader discovery | `src/pages/Friends.jsx`, `src/components/tbr/FollowSearch.jsx`, `src/components/settings/FollowersCard.jsx`, `src/pages/ReaderLibrary.jsx` | Follow requests, accepted/pending states, block/privacy enforcement, reader lookup, and public/private library access |
| Book groups and invites | `src/pages/BookGroups.jsx`, `src/pages/BookGroupRoom.jsx`, `src/components/tbr/CreateGroupDialog.jsx`, `GroupActionsCard.jsx`, `GroupInvitesCard.jsx`, `InviteReadersCard.jsx`, `GroupChatPanel.jsx` | Group creation, membership/roster, invites, role/ownership checks, room state, chat persistence, and actor/realtime behaviour |
| Comments and shared shelves | `src/components/tbr/CommentsPanel.jsx`, `src/components/tbr/SharePanel.jsx`, `src/pages/Share.jsx` | Comment CRUD/moderation, share-token creation/revocation, anonymous token reads, privacy and expiry rules |
| Search, scanning and enrichment | `src/components/tbr/OnlineBookSearch.jsx`, `ScanBook.jsx`, `ImportLibraryDialog.jsx`, `src/pages/NearMe.jsx`, `src/components/tbr/ClubDiscovery.jsx` | Server-side provider calls, validation, quotas/rate limits, caching, response-shape compatibility, and secret isolation |
| Account deletion and lifecycle | `src/pages/AccountDeletion.jsx`, `src/components/account/DeletionRequestForm.jsx`, `src/lib/deleteAccountData.js` | Verified deletion requests, confirmation, dependency cleanup, retention/audit rules, and irreversible-operation safeguards |
| Reminders and release features | `src/components/tbr/ReleaseRemindersCard.jsx`, `src/lib/bookFormats.js`, `src/lib/reviewPrompt.js` | Reminder sync, format lookup, review eligibility, scheduled work, and graceful provider failures |
| Registration analytics | `src/lib/registrationEvents.js`, `src/components/tbr/ShareDialog.jsx`, `src/pages/Register.jsx`, `src/components/tbr/AddBookDialog.jsx` | Event names/properties, privacy consent, and analytics provider or deliberate removal |

## Direct Base44 SDK surface to eliminate

Before removing `@base44/sdk`, the frontend must no longer depend on:

- `base44.auth.*` — login, registration, OTP verification, password reset, session checks, current-user lookup, profile updates, logout, and redirects.
- `base44.entities.*` — entity reads/writes/counts/deletes and query operators/pagination currently used throughout the UI.
- `base44.functions.invoke(...)` — calls to the 19 backend functions listed in `vercel-backend-migration.md`.
- `base44.analytics.*` — registration and product events.
- SDK token helpers such as `getAccessToken` in `src/lib/app-params.js`.
- Build-time integration such as `@base44/vite-plugin` in `vite.config.js`.

The final removal gate should include a repository-wide search for `@base44/`, `base44.auth`, `base44.entities`, `base44.functions`, `base44.analytics`, and `getAccessToken`. Any remaining matches must be classified as migration documentation, historical patches, or active runtime dependencies before removal.

## Data model and authorization requirements

The replacement must preserve, at minimum, the current entity families:

`AccountDeletionRequest`, `Block`, `Book`, `BookGroup`, `BookSearchCache`, `ClubSearchCache`, `Comment`, `Follow`, `GroupInvite`, `PlacesCache`, `RateLimitHit`, `ReaderSearch`, `ReleaseReminder`, `Report`, `Shelf`, `User`, `Waitlist`, and `WaitlistAttempt`.

For each collection/table, record:
- owner/tenant field and read/write authorization rule;
- public, private, or token-scoped read policy;
- unique constraints and indexes;
- cascade/deletion behaviour;
- server-only/service-role operations;
- cache and rate-limit expiry semantics;
- migration count/checksum and reconciliation strategy.

Do not translate Base44 query operators mechanically into client-side Firestore filters. Authorization must be enforced by trusted server code or verified database security rules, not merely by hiding UI controls.

## Recommended migration sequence

1. Freeze the current Base44 request/response and entity contracts with fixtures and tests.
2. Decide the identity and primary-database provider; verify the actual Firebase project configuration and permissions before treating Firebase as selected.
3. Implement server-side auth verification and repository primitives with explicit per-user authorization.
4. Port read-only catalogue/search endpoints and test response compatibility.
5. Port books/shelves and import flows, then profiles/social graph, groups/chat/invites, comments/sharing, reminders, and lifecycle/deletion.
6. Add a frontend adapter and migrate one domain at a time while the existing Base44 adapter remains available for rollback.
7. Run full web and Android internal-testing compatibility checks against staging; only then request explicit approval for cutover.

## Safety boundary

This document is planning and inventory only. It does not change application runtime behaviour, production data, Base44 configuration, Vercel deployment, Firebase resources, or the Google Play internal-testing release.
