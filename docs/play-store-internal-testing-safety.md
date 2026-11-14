# Google Play internal-testing safety gate

ShelfLife is already in the Google Play internal-testing track (confirmed by the app owner). The existing release is an active test baseline and must remain usable while the backend is replaced.

## Non-negotiable safeguards

1. Keep the currently published internal-test artifact and its Base44 configuration intact during migration.
2. Do not alter the Android package/application ID, signing configuration, Play track, version code, or currently configured API origin as part of backend-only staging.
3. Do not point an existing internal-test build at a Vercel preview or an unverified database.
4. Verify auth/session continuity and API request/response compatibility using a separate test build or controlled test environment.
5. Run end-to-end checks for login/logout, shelves, books, cover uploads, groups/invites, comments, shared shelves, waitlists, search, and account deletion before any cutover.
6. If a client update is required, create a separate Android build and request explicit approval before uploading or rolling it out to the internal-testing track.
7. Keep Base44 available for rollback until post-cutover verification is complete.

## Release gate

A backend migration is not Play-Store-ready until the current internal-test client has passed compatibility tests against the replacement backend, the data/auth migration has been rehearsed, and rollback has been tested. A green web build alone is not sufficient.
