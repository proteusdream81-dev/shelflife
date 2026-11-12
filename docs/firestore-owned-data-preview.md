# Firestore Preview migration and normalized library APIs

## Scope and safety boundary

This branch adds a normalized, read-only Firestore API foundation. It does not switch the application away from Base44, migrate data, grant Production access, modify Firestore rules, or change the current app-wide Base44 AuthContext.

Direct client Firestore access remains denied by `firestore.rules`. The Vercel API verifies Firebase ID tokens with revocation checking and uses keyless Vercel OIDC -> Google Workload Identity Federation for server-side Firestore access.

## Canonical target path

Firestore v1 is defined in `docs/firestore-schema-v1.md`. User-owned books and shelves live at:

- `users/{firebaseUid}/books/{bookId}`
- `users/{firebaseUid}/shelves/{shelfId}`

The `firebaseUid` segment is derived only from a verified Firebase ID token. No caller-supplied UID is accepted. Book and Shelf response bodies use explicit field allowlists and pagination by Firestore document ID. Share tokens, legacy Base44 IDs and unknown fields are not returned.

## Preview endpoints added by this branch

- `GET /api/library/books?limit=50&cursor=<documentId>`
- `GET /api/library/shelves?limit=50&cursor=<documentId>`

Both require an Authorization Bearer Firebase ID token and a verified email. Page size is 1-100, defaults to 50, and responses use `Cache-Control: no-store`. The routes are read-only. They do not create profiles or populate a missing target collection.

## Legacy migration audit bridge (not the app data API)

PR #21's `GET /api/data/owned?entity=Book&limit=50` remains a temporary, owner-only read bridge for checking legacy-shaped records after an explicit Firebase UID -> Base44 user ID link is verified.

It queries the migration compatibility collections by `created_by_id`; it is not the permanent data layout. Do not build new app features against this endpoint. The mapping document must be in the migration-only identity map path in the final schema, and no client access is allowed. No email-only matching or self-service mapping writes.

The guarded script `scripts/provision-identity-link.mjs` was written for a one-account operator-assisted test. Its single-account workflow is not sufficient to link the live user population; use a separately audited dual-session proof or verified operator procedure for each source identity. Do not run it in bulk and do not assume the one test link covers all users.

## Live source inventory

An IDs-only read-only Base44 audit on 10 November 2026 found 3,224 Book records across 9 distinct legacy owners, 52 Shelf records across 17 owners, and 21 User records. Total count across all 18 Base44 entities was 4,653, including cache and operational rows. The source count is paginated/non-transactional and is not a backup snapshot.

Earlier notes describing one Book and one Shelf are superseded. This migration is multi-user. Every record owner must be mapped to the correct Firebase UID before import. Missing or ambiguous owner mappings go to quarantine; never infer identity from matching email alone.

## IAM and Preview configuration

The normalized migration branch now has its own branch-scoped Preview environment configuration for Firebase project selection, Vercel OIDC/WIF service identity, Firebase web-app configuration, and the existing Base44 app ID/origin required to keep the current app shell operational during migration. All 13 variables are scoped to the `migration/firestore-normalized-v1` Preview branch; no Production or Development targets were changed.

Prior setup evidence reported `roles/datastore.user` on the Preview service account at project scope. This role is broader than the required read path. The live grant was not re-read in this code change. Verify current IAM before any production use, and replace broad permissions with a custom least-privilege role. No Production IAM change is included.

## Tests

`npm run test:firestore` covers:
- Explicit legacy identity mapping and owner isolation.
- Firestore REST decoding and nested `users/{uid}/books` / `shelves` paths.
- Document-ID pagination.
- Field projection, invalid UID/path and collection limits.
- Authenticated library handler methods, verified email, caller UID rejection and fail-closed behavior.

These are fake/in-memory tests. They do not prove live IAM, existing production data, live user mappings or deployed Firestore contents.

## Not yet enabled

- No Firestore writes/deletes through application APIs.
- No public/member/group/comment authorization.
- No share-link import or share token rotation.
- No account linking for the live user population.
- No Base44 export/import or record migration.
- No app-wide Firebase Auth cutover, Production auth/hosting/data switch, Firestore rules relaxation or Base44 shutdown.
