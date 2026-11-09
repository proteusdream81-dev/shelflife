# Firestore owner-scoped Preview read foundation

This PR adds the first server-side Firestore read path. It is separate from the active Base44 AuthContext and application screens. No Base44 data is copied, no writes are exposed, and no Production environment is changed.

## Data layout
Books are stored under `users/{firebaseUid}/books/{bookId}`. The UID comes only from a Firebase ID token verified by the Admin SDK with revocation checking enabled. The API ignores caller-supplied UIDs and never queries across users.

The response uses an explicit field allowlist. Legacy Base44 IDs, email addresses, share tokens, and share-recipient metadata are not returned.

## Endpoint
`GET /api/library/books?limit=50`
- Requires `Authorization: Bearer <Firebase ID token>`.
- Returns at most 50 records from the authenticated UID's own subcollection.
- Supports no writes, arbitrary collection names, or caller-selected user IDs.
- Returns 401 for invalid identity and fails closed with 503 if Firestore is unavailable or IAM permissions are missing.
- Responses use `Cache-Control: no-store`.

## Preview IAM prerequisite
The Preview service account currently has Firebase Authentication Viewer for revocation checks. Before this endpoint can read Firestore, grant the same dedicated service account the narrowest read-only Firestore role supported by this Native-mode database (candidate: `roles/datastore.viewer`). Do not grant Editor, Owner, or broad Datastore User. Keep any grant limited to the Preview service account; do not change Production.

## Security boundary
Firestore client rules remain deny-all. Admin SDK access bypasses Firestore rules, so all access control is enforced in trusted API code. This endpoint reads only documents already stored under a Firebase UID. It does not infer ownership from matching email addresses or create account links.

## Required before importing data
1. Prove each legacy Base44 user ID to Firebase UID link using an explicit, independently authenticated account-link flow.
2. Define and test ownership and sharing rules for shelves, follows, comments, groups, blocks, and deletion requests.
3. Validate exported/imported counts and references in staging.
4. Add mutation endpoints only after authorization and audit tests pass.

## Tests
- `npm run test:firestore`
- `npm run test:auth`
- `npm run build`

Tests use in-memory fakes and do not access real user data.
