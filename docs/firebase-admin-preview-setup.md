# Firebase Admin SDK preview credentials

This setup is deliberately limited to the Vercel Preview deployment for
`migration/firebase-admin-revocation-preview`. Do not add the credential to
Production or expose it through a `VITE_` variable.

## Required Google Cloud identity

Create a dedicated service account in project `shelflife-tbr-9754d`, for
example `shelflife-preview-auth-verifier`. Do not reuse a human user's
credentials.

Grant only the predefined **Firebase Authentication Viewer** role
(`roles/firebaseauth.viewer`) on this project. This role includes
`firebaseauth.users.get`, which the Admin SDK uses to check whether an
account is disabled and whether its refresh tokens have been revoked when
`verifyIdToken(idToken, true)` is called. It does not grant user creation,
deletion, or update permissions.

Official role permissions:
https://cloud.google.com/iam/docs/roles-permissions/firebaseauth

## Configure Vercel Preview

Create a service-account JSON key for that dedicated account and add its
complete JSON document as an **Encrypted** environment variable:

- Project: `shelflife`
- Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
- Target: Preview only
- Git branch: `migration/firebase-admin-revocation-preview`

The project selector is already configured as a non-secret Preview variable:
`FIREBASE_PROJECT_ID=shelflife-tbr-9754d`.

Never paste the private key into GitHub, source files, chat, build logs, or a
`VITE_` variable. Do not attach the variable to Production. Prefer short-lived
workload identity federation over long-lived service-account keys when that
integration is available; if a JSON key is used for this preview, restrict its
scope and rotate/delete it after the migration test.

## Verification

The API uses Firebase Admin SDK `verifyIdToken(token, true)`. The second
argument enables server-side checks for revoked tokens and disabled users.
The endpoint remains identity-only; it does not authorize Firestore access,
link legacy Base44 accounts, or read/write ShelfLife data.

After the Preview secret is configured, redeploy the branch and test
`POST /api/auth/session` with a Firebase ID token. Confirm valid tokens
return 200 and revoked, expired, disabled, or malformed tokens return 401.
If the service identity is missing or cannot reach Firebase Auth, the endpoint
fails closed with 503.

Official references:
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/auth/admin/manage-sessions
