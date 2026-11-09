# Firebase Admin Preview authentication with Vercel OIDC

This setup is limited to the Vercel Preview deployment for
`migration/firebase-admin-revocation-preview`. It uses short-lived Google
credentials through Workload Identity Federation. Do not create or store a
service-account private key.

## Google Cloud identity

Project: `shelflife-tbr-9754d` (number `599157455651`).

A dedicated service account is used:

`shelf-preview-auth@shelflife-tbr-9754d.iam.gserviceaccount.com`

Grant it only **Firebase Authentication Viewer**
(`roles/firebaseauth.viewer`) on the project. This role includes
`firebaseauth.users.get`, which the Admin SDK uses to check whether an
account is disabled and whether its refresh tokens have been revoked when
`verifyIdToken(idToken, true)` is called. It does not grant user creation,
deletion, or update permissions.

## Workload Identity Federation

Create a Workload Identity Pool and OIDC provider:

- Pool ID: `vercel-preview`
- Provider ID: `shelflife-preview`
- Issuer: `https://oidc.vercel.com/shelf-lufe`
- Allowed audience: `https://vercel.com/shelf-lufe`
- Attribute mapping: `google.subject=assertion.sub`
- Attribute condition:
  `assertion.sub == 'owner:shelf-lufe:project:shelflife:environment:preview'`

Grant the service account `roles/iam.workloadIdentityUser` to this exact
federated subject:

`principal://iam.googleapis.com/projects/599157455651/locations/global/workloadIdentityPools/vercel-preview/subject/owner:shelf-lufe:project:shelflife:environment:preview`

Do not grant access to the entire pool or to Production.

## Vercel Preview environment

Project: `shelflife` (team slug `shelf-lufe`).

Enable project OIDC token generation in team issuer mode. Set the following
variables only for Preview branch
`migration/firebase-admin-revocation-preview`:

- `FIREBASE_PROJECT_ID=shelflife-tbr-9754d`
- `GCP_PROJECT_NUMBER=599157455651`
- `GCP_SERVICE_ACCOUNT_EMAIL=shelf-preview-auth@shelflife-tbr-9754d.iam.gserviceaccount.com`
- `GCP_WORKLOAD_IDENTITY_POOL_ID=vercel-preview`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=shelflife-preview`

No JSON credential, private key, or `VITE_`-prefixed server credential is
required.

## Verification

The API uses Firebase Admin SDK `verifyIdToken(token, true)`. The second
argument enables server-side checks for revoked tokens and disabled users.
The endpoint remains identity-only; it does not authorize Firestore access,
link legacy Base44 accounts, or read/write ShelfLife data.

After the Preview federation is configured, redeploy the branch and test
`POST /api/auth/session` with a Firebase ID token. Confirm valid tokens
return 200 and revoked, expired, disabled, or malformed tokens return 401.
If the service identity is missing or cannot reach Firebase Auth, the endpoint
fails closed with 503.

Official references:
- https://vercel.com/docs/oidc/gcp
- https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/auth/admin/manage-sessions
