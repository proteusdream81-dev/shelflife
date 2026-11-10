# ShelfLife BookGroupRoom actor-state export

## Purpose

The BookGroupRoom actor stores the latest chat messages in actor-local storage. The ordinary entity export cannot read this state. This change adds a deliberately admin-only export path so retained room messages can be captured separately and encrypted before leaving the browser.

## Components

- `base44/actors/BookGroupRoom/entry.ts`: accepts `admin_export` requests only from an authenticated user whose current User record has `role: "admin"`. It returns bounded chunks only to that connection; it never broadcasts export data.
- `base44/functions/adminListBookGroupRooms/function.jsonc` and `entry.ts`: define the admin-only inventory function. It uses the documented SDK offset pagination, reads the sorted BookGroup inventory twice, and rejects malformed, duplicate, or unstable results. The BookGroup read RLS rule adds an admin-only branch without changing member/public access or write permissions.
- `src/pages/AdminActorBackup.jsx`: admin-only route at `/admin/actor-backup`. It connects to each enumerated actor, retrieves chunks, verifies room IDs, offsets and counts, and encrypts the complete bundle in the browser.
- `src/App.jsx`: registers the protected route.

## Export procedure

1. Sign in to ShelfLife as an app administrator.
2. Open `/admin/actor-backup`.
3. Select the independently secured `shelflife-tbr-backup-recovery-key.txt` file.
4. Start the export and wait for the encrypted JSON file to download.
5. Preserve the encrypted file as a separate backup artifact. Do not upload or share the recovery-key file with it.

The browser verifies the key file's SHA-256 fingerprint against its key bytes, imports the 32-byte key as AES-256-GCM, generates a fresh 96-bit IV, and emits an encrypted envelope with plaintext and ciphertext SHA-256 hashes. The plaintext bundle is not downloaded and the recovery key is not sent to Base44 or Cloudflare.

## Security and correctness properties

- Admin role is checked independently by the inventory function and each actor request.
- Actor chunks are limited to 50 messages and sent only to the requesting admin connection.
- The UI rejects wrong room IDs, unexpected offsets, incomplete pagination, and message-count mismatches.
- The UI downloads only the encrypted envelope.
- No app secret, API token, or recovery key is committed to the repository.

## Known limits

- The actor retains at most 300 messages per room. Older messages already evicted cannot be recovered.
- The inventory enumerates only BookGroup records that still exist. Actor instances whose BookGroup records were deleted are not discoverable through this path.
- Rooms are exported sequentially, so the result is not an atomic snapshot across rooms. Messages may change during export.
- This is a separate encrypted archive file. It does not upload to R2, pause writes, or replace the main entity backup pipeline.
- Actor runtime behavior must be verified after deployment in a controlled window. This pull request intentionally does not deploy the actor or function.

## Verification before production use

1. Deploy only after reviewing and approving this draft pull request.
2. Test with a dedicated non-production group and verify that a non-admin cannot enumerate or export it.
3. Verify that an admin export returns every retained message, including messages older than the 120-message client history window, in order.
4. Verify chunk boundary behavior at 0, 1, 50, 51, and 300 messages, and verify that new posts or moderation changes during a room export do not change that connection's snapshot.
5. Verify that the downloaded file is an AES-256-GCM envelope and that decryption with the recovery key reproduces the captured bundle and both hashes.
6. Confirm that normal group chat, membership, moderation, and reconnect behavior are unchanged.
7. Keep the main production capture blocked until the separate consistency, actor-history, ownership and restore gates are satisfied.
