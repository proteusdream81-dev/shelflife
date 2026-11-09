# Firebase auth preview route

This route is an isolated Firebase Authentication smoke test. It does not sign a reader into the ShelfLife application, resolve a Base44 profile, or authorise access to books, shelves, groups, or other user data.

## Preview setup

Configure these Vercel **Preview** environment variables from the Firebase web app settings:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

For the current Firebase project, the known non-secret values are:

- Project ID: `shelflife-tbr-9754d`
- Auth domain: `shelflife-tbr-9754d.firebaseapp.com`
- Web app ID: `1:599157455651:web:487f07c117301e2f9c6a96`

The API key is public Firebase web configuration, but retrieve it from the Firebase project rather than guessing it. Do not add service-account keys or other privileged credentials to `VITE_*` variables.

After changing Preview environment variables, trigger a new Vercel Preview deployment. In Firebase Authentication > Settings > Authorized domains, include the exact hostname of that Vercel Preview deployment.

## Test

Open `/firebase-auth-preview` on the Vercel Preview deployment. The page supports email/password registration, email verification, email/password sign-in, Google sign-in, and password reset. A successful sign-in displays the Firebase UID and then offers sign-out.

The app's `AuthProvider` bypasses Base44 app/session bootstrap only on this exact path, so the smoke test does not call the legacy `/api/apps/auth/login` endpoint. All other paths retain the existing Base44 auth flow.

## Safety boundary

Do not use this page for existing ShelfLife accounts or real library access. Firebase authentication alone does not map a Firebase UID to a legacy Base44 user ID. The production login, registration, profile, and data flows remain unchanged until the profile bridge and server-side authorization gates in `firebase-auth-profile-bridge.md` are completed and reviewed.
