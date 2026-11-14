# ShelfLife Firebase Emulator Tests

These tests run against isolated local Firebase emulators. They do not connect to the
ShelfLife development or production Firebase projects and do not use real reader data.

## Prerequisites

- Node.js 22
- Java 21
- Network access to download the pinned Firebase CLI and emulator binaries on first run

## Run

```sh
npm ci
npx --yes firebase-tools@14.22.0 emulators:exec \
  --project shelflife-emulator \
  --only auth,firestore \
  "npm run test:firestore-emulator"
```

The test creates a disposable identity in the Auth emulator and checks Firestore REST
requests with and without its ID token. The current migration rules intentionally deny
all direct client reads and writes, so each operation must return HTTP 403.

## Scope and limits

- This verifies that the checked-in Firestore rules load in the emulator and remain
  deny-all for unauthenticated and authenticated browser clients.
- It does not test the Vercel Workload Identity Federation runtime, Firebase Admin
  permissions, server API authorization, Base44 actor runtime, production rules, or
  any production data.
- Firebase Admin SDK requests bypass Firestore Security Rules. Server endpoints must
  continue enforcing verified identity, ownership and feature-specific authorization
  independently; emulator rule tests are not a substitute for those tests.
- Keep the rules deny-all until the replacement direct-client access model is separately
  designed and covered by positive and cross-account negative tests.
