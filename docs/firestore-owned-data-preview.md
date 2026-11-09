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

## Preview IAM prerequisite

The existing Preview service account currently has Firebase Authentication
Viewer for token revocation checks. Firestore server access additionally
requires the project-level `roles/datastore.user` role on that same dedicated
service account. This role is data-plane access, not project administration.
Grant it only after reviewing the scope, and keep the service-account
Workload Identity binding restricted to the Preview subject. No Production
variables or IAM binding are required for this branch.

## Endpoint

`GET /api/data/owned?entity=Book&limit=50`

Requires a valid Firebase ID token with a verified email. The endpoint never
accepts a caller-supplied owner ID; it derives the legacy user ID from the
verified Firebase UID mapping. Supported limits are 1–100. Unsupported entity
names are rejected. The route is read-only and fails closed if Firestore or
identity mapping is unavailable.

## Not yet enabled

- No Firestore writes or deletes.
- No public/member/group/comment access.
- No automatic email-based account linking.
- No Base44 export/import or record migration.
- No production auth cutover or Firestore rule changes.

The next safe step after granting Preview-only Firestore data access is to
provision one explicitly verified identity mapping and test an empty/read-only
collection query. Then implement feature-specific access policies and emulator
tests before importing records.
