# Firestore owned-data Preview foundation

This is a read-only, server-side first slice. It does not switch the app away
from Base44, migrate records, or grant access to Production. Direct client
Firestore access remains denied by `firestore.rules`.

## Data model

The Preview API reads only these collections: `Book`, `Shelf`,
`BookGroup`, `Follow`, `Block`, and `ReleaseReminder`. Each query is scoped
by the Base44 built-in `created_by_id` field. The first slice intentionally
uses owner-only access, even where Base44 permits public or member reads; this
is a safe subset until feature-specific authorization is implemented.

## Identity mapping

A Firebase UID is not a Base44 user ID. The API requires an explicit Firestore
mapping document at `identityLinks/{firebaseUid}` with:

- `status: "verified"`
- `base44UserId: "<exact Base44 User.id>"`
- optional audit metadata such as `verifiedAt` and `verifiedBy`

Only a trusted migration operator may create this document after verifying
account ownership. Do not match accounts by email alone, do not let a client
create its own link, and do not put mapping records in a client-writable path.
The API returns HTTP 409 until the mapping exists.

### Guarded operator provisioning

The repository includes `scripts/provision-identity-link.mjs`. Run it only
from an authenticated operator shell with Application Default Credentials
for the ShelfLife Firebase project and permission to read Firebase Auth users
and create Firestore documents. The script verifies that the supplied Firebase
UID exists, is enabled, has a verified email, and that the verified email
matches the operator-supplied email. It requires an explicit ownership
attestation, records the operator and verification time, and refuses to
overwrite an existing mapping.

From the checked-out migration branch:

```bash
npm ci
node scripts/provision-identity-link.mjs \
  --firebase-uid "<FIREBASE_UID>" \
  --email "<VERIFIED_EMAIL>" \
  --base44-user-id "<EXACT_BASE44_USER_ID>" \
  --verified-by "<OPERATOR_EMAIL>" \
  --attest-account-ownership
```

The operator must independently confirm that the Firebase account and legacy
Base44 account belong to the same person before supplying the attestation.
Email equality is a consistency check, not a substitute for that confirmation.
Do not run this against Production or use it to link accounts in bulk.

## Preview IAM prerequisite

The Preview service account requires Firebase Authentication Viewer for token
revocation checks and Firestore data-plane access for the owned-data endpoint.
The current Preview setup grants `roles/datastore.user` to the dedicated
service account at project scope. This is broader than ideal; reduce it to a
custom least-privilege role or a narrower condition before any Production use.
Keep the service-account Workload Identity binding restricted to the Preview
subject. No Production variables or IAM binding are required for this branch.

## Endpoint

`GET /api/data/owned?entity=Book&limit=50`

Requires a valid Firebase ID token with a verified email. The endpoint never
accepts a caller-supplied owner ID; it derives the legacy user ID from the
verified Firebase UID mapping. Supported limits are 1–100. Unsupported entity
names are rejected. The route is read-only and fails closed if Firestore or
identity mapping is unavailable.

## Not yet enabled

- No Firestore writes or deletes through the application API.
- No public/member/group/comment access.
- No automatic email-based account linking.
- No Base44 export/import or record migration.
- No production auth cutover or Firestore rule changes.

After the one-account link is provisioned, run the read-only Preview endpoint
with a fresh authenticated Firebase session. Confirm the returned records are
owned by the linked Base44 user and that another account receives no records.
Then implement feature-specific access policies and emulator tests before
importing records.


## Preview-only cover authorization API

The cover-storage Preview Worker uses a narrowly scoped server API before writing an object:

- `POST /api/covers/authorize` with the caller's Firebase ID token and a JSON body containing only `bookId`.
- The API verifies the ID token with Firebase Admin revocation checking and requires a verified email.
- It reads exactly `users/{verifiedUid}/books/{bookId}` through the existing Vercel OIDC → Google Workload Identity Federation Firestore adapter. The UID is derived from the verified token; the request cannot supply an owner UID or permission flag.
- It returns only `{ authorized: true, bookId }` or an allow/deny/service-unavailable result. It never returns book contents.
- Missing books are denied. Firestore/IAM/service errors fail closed with HTTP 503.
- It does not authorize shared-shelf members to replace another reader's cover; the operation is owner-only. It does not write Firestore, create identity links, import data, or alter rules.
- The verified custom Preview domain `preview.shelflifetbr.com` is attached to this Preview branch. Production and other environments are not targeted.

Automated tests cover HTTP method, authentication, verified-email requirement, body allowlisting, UID-derived nested path, missing-book denial and fail-closed Firestore errors. Tests use mocks; a live IAM and signed-in user test is still required before enabling the Worker integration.
