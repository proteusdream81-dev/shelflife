# ShelfLife-TBR private R2 cover service

This Worker is a staged backend component for the private `shelflife-tbr-covers` R2 bucket. It is not wired into the app yet.

## Required Worker configuration

- R2 binding: `COVERS` -> `shelflife-tbr-covers`
- Variable: `FIREBASE_PROJECT_ID=shelflife-tbr-9754d`
- Variable: `ALLOWED_ORIGINS` -> comma-separated exact HTTPS origins only; replace the placeholder with verified Vercel preview and production origins.
- Secret: `SIGNING_SECRET` -> at least 32 random bytes, set with Wrangler secret; never commit it.

## API

- `PUT /v1/covers`: Firebase ID token required. Accepts JPEG, PNG, WebP up to 5 MiB. Verifies token signature against Google's Firebase Secure Token JWKS, issuer, audience and required time claims; creates a UID-scoped opaque object key and returns a seven-day signed read URL. This standalone verifier does **not** check token revocation or disabled-user state; use the revocation-aware Firebase Admin verifier before any production deployment.
- `GET /v1/covers/read/:key?expires=...&sig=...`: verifies HMAC signed read URL; R2 bucket remains private.
- `DELETE /v1/covers/:key`: Firebase ID token required; only the token owner's UID prefix can be deleted.
- `GET /health`: basic health response only.

## Important integration gates

1. The active app currently uses Base44 authentication. The upload endpoint deliberately rejects Base44 tokens. Do not switch the UI to this service until Firebase Auth is genuinely initialized and users obtain Firebase ID tokens.
2. The returned read URL expires after seven days. The app must refresh it when rendering/reopening shelves, rather than treating it as a permanent cover URL. Persist `objectKey` and metadata in the book record, not the signed URL.
3. This Worker enforces per-UID object-key ownership, but it does not yet consult Firestore book ownership or shelf-sharing permissions. It currently permits any authenticated Firebase project user to store objects under their own UID. Before preview integration, add an authoritative Firestore authorization check for the book record and define how shared shelves are allowed to read cover URLs.
4. Upload streaming is capped at 5 MiB and validates file signatures, but it does not decode pixels, inspect dimensions, or re-encode images. Add a trusted image-processing stage to limit dimensions and reject malformed/decompression-bomb images before production.
5. Configure exact CORS origins only. Do not enable public R2 bucket access or attach a public bucket domain.

## Deployment

Use Wrangler from a trusted environment after replacing the origin placeholder and setting the secret:

```sh
npx wrangler secret put SIGNING_SECRET
npx wrangler deploy
```

Deploy to a preview Worker first. Validate authentication, cross-user denial, invalid MIME/signature, size limits, signed URL expiry, delete ownership, and CORS before wiring the app. No production app deployment is included in this staged PR.
