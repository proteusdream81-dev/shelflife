# ShelfLife-TBR backup: direct Base44 platform export

**Status: design note; no production export or upload has run.** This is the no-Builder-credit path. Keep PR #25 draft and unmerged until the runtime, consistency, and restore gates pass.

## Verified Base44 API contract

Use the connected ShelfLife app only:

- App ID: `6ac5feeacf2ab847112ee3ed`
- App platform API: configured at runtime through `BASE44_PLATFORM_HOST`; do not hard-code a preview host.
- Workspace API key: `BASE44_WORKSPACE_API_KEY` (workspace keys use the `b44k_` prefix).
- Active workspace: `BASE44_ORG_ID`, sent as `X-Active-Workspace-Id`.
- Authentication: `Authorization: Bearer <workspace API key>`.
- Keep all credentials in a secrets manager. Never place them in source, browser code, build logs, artifacts, or chat. Use a read-only key if Base44 exposes the required read scope for the target endpoints.

The Base44 platform API documentation currently describes these read paths:

### Custom entities (17)

`GET /api/apps/{app_id}/entities/{entity_name}/count`

`GET /api/apps/{app_id}/entities/{entity_name}/v2/list?limit=5000&fields=...`

- The list endpoint is beta and cursor-paginated. Pass `next_cursor` back as `cursor`; stop only when `has_more` is false.
- The documented maximum page size is 5,000.
- The cursor is bound to the credential, app, entity, filter, sort, and selected fields.
- Deleted records are excluded from this endpoint.
- Row-level security applies to both list and count. A count/list match proves parity only for records visible to that credential, not that every record in the app is visible.
- The 17 custom entities are: GroupInvite, Book, Follow, Comment, BookGroup, ReaderSearch, BookSearchCache, WaitlistAttempt, AccountDeletionRequest, Report, RateLimitHit, Block, PlacesCache, Shelf, Waitlist, ClubSearchCache, ReleaseReminder.

### App users (separate endpoint)

`GET /api/apps/{app_id}/entities/User/count`

`GET /api/apps/{app_id}/entities/User?limit=10000&skip=0`

- Do not pass `User` to the generic `v2/list` endpoint. Base44 documents that as a separate, disconnected entity.
- The app-user endpoint returns the real signed-up/invited-and-signed-in app users, supports `limit` up to 10,000 and `skip`, and applies User-entity RLS.
- Some platform-managed accounts and short-lived test accounts are excluded from the user count/list by design. Preserve the endpoint's returned user records, but do not assume it is a list of every Base44 workspace collaborator.

### Source code ZIP

`GET /api/apps/{app_id}/coding/export-to-zip`

Base44 documents this as a binary ZIP of saved app source. The connected Base44 API tool cannot return the binary response, so this needs a separate authenticated REST runner if source-code capture is included. Do not treat the ZIP as an entity-data backup.

## Current inventory observations (10 November 2026)

- The 17 custom entity count endpoints plus the app-user count endpoint previously returned 4,653 records in total, including 21 app users. These are credential-visible counts, not a certified complete snapshot.
- The User list endpoint returned 21 app-user records.
- Book records exposed 9 distinct `created_by_id` values, all matching listed app-user IDs.
- Shelf records exposed 17 distinct `created_by_id` values; two values did not match the current app-user list. These may represent removed users or other legacy identities and must be investigated rather than remapped by email.
- Entity schemas contain row-level read rules, including owner-scoped Book and Shelf rules. The exporter must explicitly prove its credential's visibility before treating counts as complete.
- The connector truncates large API responses at approximately 24 KB. Do not use a truncated response as a complete page or checkpoint snapshot; use smaller cursor pages in the direct runner.

## Required capture protocol

1. Fetch schemas and the full entity inventory; store the schema version/hash in the manifest.
2. For every custom entity, fetch its count and every cursor page. Validate response shape, unique IDs, no repeated cursors, and exact list/count parity.
3. Fetch app users through the dedicated User endpoints and validate list/count parity. Record platform-managed-account exclusions as a scope limitation.
4. Run a second complete inventory pass and compare sorted record-ID plus updated-date digests per entity. This detects observed changes; it is not a mathematical substitute for an atomic snapshot or a supported write-quiescence window.
5. Preserve deleted-record/trash data separately if the documented trash endpoint and retention permit it. The current v2 list excludes deleted records.
6. Inventory actor rooms independently. Current BookGroup records do not enumerate deleted/orphaned actor IDs. The actor stores at most 300 messages per room; older messages may already be irrecoverable.
7. Generate a manifest that names every omission and consistency limitation. It must remain `INCOMPLETE` while writes are live or actor history is incomplete.
8. Encrypt before leaving the runner. Store a recoverable key outside the backup object and outside the same cloud account; test recovery before any upload.
9. Upload only after explicit authorization and completion of the required consistency gate. Verify object size, SHA-256 checksum, metadata, and a full read-back/decrypt test.
10. Restore into an isolated non-production target and verify record counts, relationships, user identity mapping, and application behavior before calling the backup recoverable.

## Cloudflare R2 destination

- Bucket: `shelflife-tbr-9754d-migration-backups`
- Prefix: `backups/`
- Bucket is private and currently empty.
- 90-day lock and lifecycle rules are already configured for that prefix.
- A future runner may use the Cloudflare R2 object API or the S3-compatible API. Keep R2 credentials server-side and least-privilege. Do not add public access or a public development URL.
- No upload is permitted merely because the bucket is ready. The current capture is still incomplete.

## Explicit safety boundaries

- Read-only Base44 calls only during investigation.
- No app writes, deployments, PR merge, production write pause, or retention changes.
- No source data upload while consistency, actor history, key recovery, checksum/read-back, and isolated restore remain unresolved.


## Deleted-record trash endpoint — verified

`GET /api/apps/{app_id}/entities/{entity_name}/trash` is a separate beta endpoint for deleted records still retained in Base44's trash.

- It bypasses entity row-level security and returns all deleted records still in that entity's trash.
- It supports `limit` up to 10,000 and `skip` pagination; omitting `limit` requests the whole trash, which is not safe through the connector's response-size limit.
- It includes `deleted_date` and the record payload. The direct runner must page in small batches and include trash records as a separate manifest section, not mix them with active records.
- Removed app users are not included in trash. The User trash endpoint returns 404, so deleted-user identities are not recoverable through this route.
- A one-record probe on 10 November found retained deleted records in Book, Follow, BookGroup, ReaderSearch, BookSearchCache, WaitlistAttempt, RateLimitHit, Block, Shelf, Waitlist and ClubSearchCache. The probe did not count the total deleted records.
- The final export must record trash counts and pagination parity for every custom entity. Do not treat active entity counts as full coverage while trash is omitted.


## Retained trash inventory — 10 November 2026

The direct platform API was queried with `limit=100`, `fields=id,deleted_date`, and `skip` pagination until a short page was returned. The following counts are exact for records currently retained in the trash of each custom entity:

| Entity | Deleted records in trash |
| --- | ---: |
| Book | 463 |
| Follow | 3 |
| BookGroup | 2 |
| ReaderSearch | 1 |
| BookSearchCache | 76 |
| WaitlistAttempt | 12 |
| RateLimitHit | 428 |
| Block | 1 |
| Shelf | 37 |
| Waitlist | 20 |
| ClubSearchCache | 1 |
| GroupInvite, Comment, AccountDeletionRequest, Report, PlacesCache, ReleaseReminder | 0 each |
| **Total** | **1,044** |

This is a separate deleted-record population in addition to the 4,653 active records previously counted. It is not a full historical archive: permanently erased records and removed app-user records are outside this trash endpoint. Counts can change as records are deleted, restored, or permanently erased. The exporter must capture the actual trash record payloads and timestamps, not just these counts.
