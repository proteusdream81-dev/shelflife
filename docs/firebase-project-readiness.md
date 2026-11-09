# Firebase project readiness checklist

This checklist records the Firebase setup for the ShelfLife migration. It is deliberately separate from production cutover: the existing Base44 application remains authoritative until migration tests pass and the owner explicitly approves a switch.

## Current project

- Firebase project: `shelflife-tbr-9754d`
- Region: `australia-southeast1` (Sydney)
- Firestore: default Native database created; delete protection enabled.
- Firebase Web app: registered.
- Firebase Authentication API: enabled at the Google Cloud API level.
- Email/Password sign-in provider: enabled in Firebase Authentication (owner-confirmed, 2026-11-09).
- Google sign-in provider: enabled in Firebase Authentication (owner-confirmed, 2026-11-09).
- Firestore rules: repository starter is deny-all and has **not** been deployed.
- Firebase Storage: not initialised. The Firebase console currently requires the Blaze billing plan to start Storage. Storage is not a blocker for Auth and Firestore migration work.

## Authentication provider status and next checks

The owner has confirmed that **Email/Password** and **Google** sign-in providers are enabled in Firebase Authentication.

Next, verify the provider configuration without changing the existing Base44 login:

1. Confirm the Google provider's support email is set to the intended ShelfLife support contact.
2. Configure email verification and password-reset templates with ShelfLife branding and a support contact.
3. In Authentication settings → Authorized domains, add only the exact development/preview hosts that will be used for testing. Do not add broad wildcard domains.
4. Test both providers using dedicated test identities on a preview host. Do not use a real reader's existing ShelfLife email until the legacy-account linking flow is implemented.
5. Keep Base44 authentication active; do not replace production login settings.

Enabling providers does not migrate existing Base44 accounts and does not grant access to ShelfLife data. Do not wire the production login UI until the server-side identity-linking and profile-resolution gates below are satisfied.


### Authorized domains (owner-confirmed, 2026-11-09)

Firebase Authentication currently lists:

- `localhost` (Default)
- `shelflife-tbr-9754d.firebaseapp.com` (Default)
- `shelflife-tbr-9754d.web.app` (Default)
- `shelflife-git-migration-vercel-backend-foundation-shelf-lufe.vercel.app` (Custom)
- `shelflife-git-migration-vercel-backend-foundation-shelf-lufe.vercel` (Custom)

The `.vercel.app` host is the apparent Vercel preview host for the migration branch. The final custom entry ends in `.vercel` rather than `.vercel.app`; treat it as unverified and do not rely on it until the exact hostname is checked in Vercel. Do not remove either entry or add further domains as part of this documentation update.

## Vercel preview environment

The Firebase adapter is opt-in and isolated. Configure values only in the Vercel project's **Preview** environment until preview tests pass:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_PROJECT_ID`

Use the values from the Firebase Web app configuration. The Web API key is public client configuration; it is not an Admin credential. Keep the existing Base44 environment variables in place because the current application still uses Base44.

A future Firestore Admin API implementation will require a server-only service identity with narrowly scoped permissions. Do not put a service-account key in source control, browser variables, issue comments, or chat. Prefer workload identity federation where supported; otherwise store a dedicated, rotated credential only in Vercel encrypted environment variables. Do not grant project Owner or Editor to an application runtime identity.

## Firestore safety

- Keep `firestore.rules` deny-all until the complete client/server access model and emulator tests are ready.
- Do not deploy the starter rules as a production change.
- Admin SDK calls bypass Firestore Security Rules, so every server route must independently authenticate and authorize the caller.
- Do not import Base44 user or book records into this project yet.
- Do not point the live Base44 application or Android release at Firebase during this stage.

## Storage and cost decision

Firebase Storage is currently unavailable until the project is upgraded to Blaze. Do not upgrade solely to continue Auth/Firestore work. Before enabling Storage, estimate expected stored bytes, downloads/egress, operations, and backup needs; set billing budgets and alerts. Existing custom-cover URLs should remain unchanged until a replacement storage plan is approved.

## Completion gates before data migration

- [ ] Email/Password provider enabled and tested on a dedicated test account.
- [ ] Google provider enabled and tested if retained in the final sign-in design.
- [ ] Verification and password-reset email flows tested on a preview host.
- [ ] Preview environment variables configured without exposing secrets.
- [ ] Admin API uses a least-privilege server identity and revocation-aware token verification.
- [ ] Firestore repository and authorization tests pass in the Firebase Emulator Suite.
- [ ] A UID-to-legacy-user mapping and account-linking flow are implemented and reviewed.
- [ ] Base44 data export, staging import, count checks, reference checks, and idempotency tests are complete.

Passing these gates does not itself authorize production cutover. Keep Base44 available for rollback and obtain explicit approval before changing production traffic or the Android API origin.
