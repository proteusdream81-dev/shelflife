# Firebase Admin Preview authentication with Vercel OIDC

This setup is limited to the Vercel Preview deployment for the migration
branches. It uses short-lived Google credentials through Workload Identity
Federation. Do not create or store a service-account private key.

## Google Cloud identity

Project: `shelflife-tbr-9754d` (number `599157455651`) or the separate
dev project `shelflife-tbr-dev` (number `1011106075373`) depending on which
Preview environment variables are bound.

A dedicated service account is used (examples):

- `shelf-preview-auth@shelflife-tbr-9754d.iam.gserviceaccount.com`
- `shelf-preview-auth-dev@shelflife-tbr-dev.iam.gserviceaccount.com`

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

`principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel-preview/subject/owner:shelf-lufe:project:shelflife:environment:preview`

Do not grant access to the entire pool or to Production.

## Vercel Preview environment

Project: `shelflife` (team slug `shelf-lufe`).

Enable project OIDC token generation in team issuer mode. Set the following
variables for the migration Preview branches:

- `FIREBASE_PROJECT_ID` — the actual project the WIF pool is attached to
- `GCP_PROJECT_NUMBER` — matching number
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_WORKLOAD_IDENTITY_POOL_ID=vercel-preview`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=shelflife-preview`

No JSON credential, private key, or `VITE_`-prefixed server credential is
required.

## Client-side Google sign-in on Preview (Authorized Domains)

Every new Vercel Preview deployment receives a unique hostname of the form:

```
shelflife-<hash>-shelf-lufe.vercel.app
```

Firebase Google sign-in only works from domains listed under
**Authentication → Settings → Authorized domains**. If the current Preview
hostname is missing, sign-in fails (often surfaced as `auth/unauthorized-domain`
or a generic "Domain is not valid" when a malformed string is submitted).

### Exact steps for each new Preview

1. Open the live Preview URL in the browser.
2. Copy **only the hostname** from the address bar.
   - Correct: `shelflife-itag589bg-shelf-lufe.vercel.app`
   - Incorrect (will be rejected): `https://…`, any trailing slash, path, or port
3. Firebase Console → the project the Preview is bound to →
   **Authentication** → **Settings** → **Authorized domains** → **Add domain**
   → paste the hostname → Save.
4. (Recommended) Also update the Google Cloud OAuth 2.0 Client:
   - **APIs & Services → Credentials → OAuth 2.0 Client ID**
   - Authorized JavaScript origins: `https://<hostname>`
   - Authorized redirect URIs: `https://<hostname>/__/auth/handler`
5. Hard-refresh the Preview (or open a new tab) and retry Google sign-in.

Because every push creates a new Preview hostname, this step must be repeated
for each deployment while the migration is in progress. A stable custom domain
on the Preview branch removes the need to re-authorize every time.

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
