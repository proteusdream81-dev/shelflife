# Direct REST backup runner — operating and recovery contract

**State: implementation staged; not live-credential tested. No production data has been exported or uploaded.** Keep PR #25 and this runner PR draft/unmerged until the gates below pass.

## Runner

- Entry point: `scripts/backup/base44DirectExport.js`
- Tests: `scripts/backup/base44DirectExport.test.js`
- Command: `node scripts/backup/base44DirectExport.js`
- Optional source archive: append `--include-source-zip`.
- R2 upload is deliberately disabled unless both `--upload` and `ALLOW_R2_UPLOAD=true` are present. Even then, the runner rejects upload while the manifest is `INCOMPLETE`.
- The runner is read-only against Base44. It writes encrypted local page bundles and a metadata-only local manifest. It never pauses writes, deploys, merges, or changes source records.

### Local key-recovery and integrity drill

After a capture has completed, copy the encrypted bundle and its metadata-only `manifest.json` to a clean isolated runner. Retrieve the AES key from the independent escrow (not from the CI secret), set `BACKUP_ENCRYPTION_KEY_BASE64` and `BACKUP_VERIFY_DIR`, then run `npm run verify:backup`. The verifier decrypts every encrypted object into memory, validates AES-GCM authentication, byte lengths and SHA-256 against the sidecar, and checks the encrypted manifest capture identity. It does not write plaintext records to disk or restore into an application. A successful result demonstrates key recovery and local bundle integrity only; it is not a full app restore.

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `BASE44_PLATFORM_HOST` | Exact Base44 platform API host, HTTPS only |
| `BASE44_WORKSPACE_API_KEY` | Dedicated workspace API key; use read-only scope if Base44 exposes it |
| `BASE44_ORG_ID` | Active Base44 workspace ID sent as `X-Active-Workspace-Id` |
| `BACKUP_ENCRYPTION_KEY_BASE64` | Base64-encoded 32-byte AES-256 key, held outside source and R2 |
| `BASE44_APP_ID` | Optional; defaults to the verified ShelfLife-TBR app ID |
| `BASE44_PAGE_SIZE` | Optional; default 200, capped at 500 |
| `BACKUP_OUTPUT_DIR` | Optional; default `./shelflife-backup` |

R2 upload-only variables (not needed for a local capture):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_API_TOKEN`
- `R2_BUCKET` (expected: `shelflife-tbr-9754d-migration-backups`)

Never store credentials in repository files, client code, workflow YAML, logs, artifacts, or chat. Do not reuse a general Cloudflare account token. For the Cloudflare REST API, scope an API token to the single backup bucket with **Workers R2 Storage Bucket Item Write** and **Workers R2 Storage Bucket Item Read**; do not grant account-wide bucket administration. Cloudflare distinguishes this REST token permission from S3 Object Read & Write credentials. References: [R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/) and [R2 API surfaces](https://developers.cloudflare.com/r2/api/).

Base44 must issue a dedicated workspace API key for the ShelfLife workspace, with read-only permission for the required entity, user, trash and source-archive GET routes if available. The connected Base44 integration is not itself a reusable REST credential. If Base44 cannot issue a sufficiently scoped key, stop and obtain a security review before using a broader key.

## Secret provisioning and key custody

No Base44 API key, Cloudflare R2 API token, or encryption key is currently provisioned for this runner. The current GitHub integration exposes repository file and workflow operations but not repository Actions-secret creation; therefore this session cannot safely write secrets into GitHub Actions. Do not send secrets through ChatGPT.

When a secret-management route is available:

1. Create a dedicated Base44 workspace key. Restrict it to GET/read access for this app and the required routes; record its owner, scope and expiry/rotation plan.
2. Create a Cloudflare API token scoped only to bucket `shelflife-tbr-9754d-migration-backups` with **Workers R2 Storage Bucket Item Write** and **Workers R2 Storage Bucket Item Read** for Cloudflare REST object PUT/GET verification. Do not use a token that can manage all account buckets.
3. Generate a cryptographically random 32-byte AES key. Store it as a protected CI secret and escrow a second recoverable copy in a separate, access-controlled password manager or offline encrypted vault. The escrow copy must not be stored in this R2 bucket, the same GitHub repository, or the backup bundle.
4. Record key ID/version, custodian, creation date and recovery procedure in the organisation's secret inventory; never record the key value in the manifest.
5. Perform a recovery drill: retrieve the escrowed key into a clean isolated runner, decrypt a known test fixture, and verify its SHA-256. A successful encrypt-only run is not a key-recovery test.
6. Configure GitHub Actions secrets only after the repository environment and branch protections are reviewed. Do not expose secrets to untrusted fork pull requests or print environment values.

## Capture and consistency protocol

The runner exports active custom entities, real app users, and retained deleted-record trash as separate datasets. It validates response shapes, unique IDs, pagination termination, active count/list parity, and a second full pass comparing digests of complete canonical records (stable JSON key ordering), so field-level changes are detected even when an update timestamp does not advance. Trash is also re-read and compared. It records per-page plaintext and ciphertext SHA-256, byte lengths and encrypted object names.

A matching second pass is **not an atomic snapshot**. It can miss a transient write that occurs and is later reverted; RLS can hide records from both passes. Therefore the manifest stays `INCOMPLETE`.

A defensible production capture requires a separately approved maintenance window and a source-supported write-quiescence protocol:

1. Inventory every write path: client CRUD, backend functions, scheduled jobs, integrations, queues, actor state and admin operations.
2. Obtain explicit operational approval for a time-bounded write freeze. Do not infer approval from this PR or from approval to build the runner.
3. Enter maintenance/read-only mode at the source, stop scheduled writers and integrations, drain in-flight requests/queues, and verify no actor messages or entity writes remain in flight.
4. Record the freeze start, source app/version, entity counts, schema hashes and actor inventory. Capture active entities, User records, retained trash, source archive and actor history while writes remain frozen.
5. Run a second complete pass while still frozen. Require exact record-ID and updated-date digest parity, count parity, complete pagination, and no unexplained RLS exclusions. Capture provider-side audit/version evidence for the frozen interval where available.
6. Generate encrypted objects and manifest; verify local ciphertext hashes, upload, then independently read every object back and compare byte count and SHA-256.
7. Keep the source read-only until the isolated restore validation passes or the operator explicitly accepts a documented incomplete backup. Resume writes only after the capture is sealed and the operator records the resume time.
8. If a freeze cannot be supported or authorised, retain the two-pass result as a best-effort, non-atomic capture and label it `INCOMPLETE`; do not call it a disaster-recovery backup.

Base44 version history currently has only sparse checkpoints across Book, Shelf and WaitlistAttempt, with checkpoint times not aligned. It is not a substitute for a complete cross-entity snapshot.

## Explicitly unresolved recovery scope

- **Actor-room ID inventory:** the runner now derives actor room IDs from active `BookGroup` records and retained-deleted `BookGroup` trash records. It writes a sorted, de-duplicated `actor_room_inventory` into the manifest and labels each ID as active or retained-deleted. This closes the known-group-ID enumeration gap for records still visible in those two datasets; it does not enumerate actors whose group records were permanently deleted or orphaned.
- **Actor runtime history:** the Base44 platform API catalogue inspected on 14 November 2026 contains no actor-management or actor-storage export endpoint. Actor state is held inside each `BookGroupRoom` runtime instance; the app code persists only the most recent 300 messages per room. No verified external API currently lets this runner read `this.storage`. A separately deployed, owner-authorized actor export path or provider-supported actor export is still required. Messages already evicted beyond the 300-message cap are not recoverable from the actor.
- **Deleted users:** the dedicated User trash route returns 404; removed app-user records are not present in the real User list or custom-entity trash. The current User list is not a historical identity archive. The app's account-wipe implementation deletes the User record and associated user-owned/relationship rows; once that has run, the removed profile cannot be reconstructed from the current entity APIs.
- **Legacy creator references:** Shelf has two `created_by_id` values not matching the current User list. Keep them as unresolved source identifiers; do not map by email or guess a Firebase UID.
- **RLS visibility:** entity list/count routes run under the caller's app access rules. Base44's data-checkpoint snapshot endpoint is documented to bypass RLS, but it is available only when version history is enabled. Live status check on 14 November 2026 returned `needs_upgrade`, with no retention window; checkpoint snapshots are therefore unavailable without a separate plan upgrade. Do not upgrade or incur billing without approval.
- **Atomicity:** a two-pass digest detects observed changes but is not a transactionally consistent cross-entity snapshot. Base44 version checkpoints are created per entity and do not provide a proven single cross-entity cut. A supported write-quiescence protocol and explicit maintenance approval remain necessary.
- **Permanent deletions:** retained trash is time-limited and excludes records permanently erased after retention. Historical totals from prior captures are not a complete permanent-deletion ledger.

These are still genuine recovery limitations. The runner now inventories known actor room IDs, but does not export actor runtime messages, reconstruct deleted user identities, bypass RLS, or prove an atomic source snapshot. The manifest must remain `INCOMPLETE` until the missing evidence is supplied or the owner formally accepts the residual recovery objective.

## Integrity and isolated restore acceptance

Before any backup is called recoverable:

1. Recover the AES key from the independent escrow, not from the CI secret.
2. Decrypt every encrypted object in a clean runner. Verify AES-GCM authentication, plaintext byte length and plaintext SHA-256 against the manifest.
3. Verify each ciphertext read back from R2 matches the locally recorded ciphertext SHA-256 and byte length. Do not rely solely on ETag.
4. Restore into a separate, isolated non-production Base44 app or other formally approved target with no production credentials or user traffic.
5. Validate every entity schema, record count, unique IDs, relationships/references, deleted-record status, user identity mappings, and application-level invariants. Validate actor-room state separately if a supported import route is established.
6. Produce a signed restore report with target ID, test date, object checksums, counts, failures and unresolved gaps.
7. Only mark the backup complete if the restore report passes and all required omissions are either resolved or explicitly accepted by the system owner as an incomplete recovery objective.

No isolated target or write-capable restore credential is currently configured. No restore has been attempted. The current runner deliberately does not write to any Base44 target.

## Current state

- R2 destination remains private; the 90-day retention/lock rules apply to `backups/`.
- No credentials have been provisioned for this runner.
- No source records or source ZIP have been exported by this runner.
- No R2 objects have been uploaded.
- No production writes have been paused.
- No isolated restore or key-recovery drill has been performed.
- Status remains **INCOMPLETE / NOT RECOVERABLE** until all gates pass.

## Isolated restore mechanics and non-restorable data

The source runner now captures the complete Base44 entity-schema response as an encrypted dataset and compares its canonical JSON digest on the second pass. This provides the schema inventory needed to plan a restore; it does not itself establish a valid target.

Verified Base44 write semantics:

- `POST /api/apps/{app_id}/entities/{entity_name}/bulk` creates new records, checks every record against the target schema and RLS create rules, and ignores supplied `id`, `created_date`, `updated_date`, `created_by` and `created_by_id`. It is beta, has no idempotency key, can partially write if a request fails mid-write, and a retry can create duplicates. It does not trigger app webhooks/automations/workflows.
- `POST .../upsert` is also beta, requires a declared scalar key, enforces RLS, and also ignores the original IDs and system fields. It is not a universal replay primitive.
- A separate write-capable key is required; the documented bulk/upsert endpoints explicitly reject read-only keys. Keep the export key read-only.
- The built-in `User` entity is disconnected from custom entity bulk routes. App users require their own identity/invitation lifecycle; no supported endpoint has been verified for recreating historical app-user IDs.
- The trash restore endpoints restore records already in the target app's own trash; they do not import archived trash records from a different app.
- Actor-room history has no verified import route. The runner does not attempt to recreate actor storage.

A safe future restore importer must therefore use a two-phase, schema-driven process in a new isolated target app:

1. Compare source and target schema snapshots; reject missing/changed entities or fields.
2. Extract only user-defined fields, retaining original source IDs in a separate mapping ledger.
3. Create dependency-ordered records in batches; capture every returned target ID and map source ID to target ID.
4. Rewrite every declared relationship/reference field using the mapping ledger, then update target records in a second pass. Unknown or ambiguous reference fields must stop the restore rather than be guessed.
5. Reconcile counts, unique constraints, required fields, RLS, references and app-specific invariants. Record that Base44-generated system timestamps and creator IDs differ from source.
6. Re-provision app users through a separately approved authentication/invitation process and map identities only from verified identifiers; do not map by email alone.
7. Treat retained trash, deleted users, actor history and permanent deletions as archival omissions unless a supported target restore mechanism is established.

No isolated target app, write-capable restore key, schema-validated importer, user re-provisioning process or actor restore API is configured. A full isolated restore has not been performed and cannot currently be certified.


## Actor-room export transport

- The browser exporter requests actor history in sequential chunks of at most 50 messages. Each actor creates a connection-scoped in-memory snapshot on offset zero and serves only the exact next offset for that connection.
- Every chunk re-checks the current app-admin role. A revoked role, invalid page size, out-of-order offset, or expired actor session fails the room export closed. The connection close and final chunk clear the snapshot.
- The browser verifies room ID, offset sequence, stable total, retention limit, continuation flag, message IDs and final message count before adding the room to the encrypted archive.
- The snapshot is stable within one room while live chat continues, but it is not atomic across rooms or entities. Actor hibernation/restart can invalidate an in-memory export session; the browser must discard the partial room and restart rather than combine pages from different snapshots.
- Chunking reduces per-message payload size and supports the full retained 300-message room cap. It does not recover messages already evicted, deleted/orphaned actor IDs, or provide a source-wide write freeze.
- This protocol is draft code only until the actor and function changes are published to a non-production Base44 app and exercised with both admin and non-admin sessions. Do not deploy the actor/function to Production as part of this change.
