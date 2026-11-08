import { createPublicKey, verify as verifySignature } from "node:crypto";

const GOOGLE_SECURE_TOKEN_CERTS =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const PROJECT_ID = "shelflife-tbr-9754d";
const CLOCK_SKEW_SECONDS = 5 * 60;

let cachedCertificates = null;
let certificatesExpireAt = 0;
let certificateRequest = null;

function unauthorized() {
  return { ok: false, status: 401, error: "Unauthorized" };
}

function decodeJsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function getSigningCertificates(forceRefresh = false) {
  if (!forceRefresh && cachedCertificates && Date.now() < certificatesExpireAt) {
    return cachedCertificates;
  }

  if (certificateRequest) return certificateRequest;

  certificateRequest = (async () => {
    const response = await fetch(GOOGLE_SECURE_TOKEN_CERTS, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Google signing certificates unavailable");

    const certificates = await response.json();
    if (!certificates || typeof certificates !== "object" || Array.isArray(certificates)) {
      throw new Error("Invalid Google signing certificate response");
    }

    const cacheControl = response.headers.get("cache-control") || "";
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 0);
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      throw new Error("Google signing certificate cache lifetime missing");
    }

    cachedCertificates = certificates;
    certificatesExpireAt = Date.now() + maxAge * 1000;
    return cachedCertificates;
  })();

  try {
    return await certificateRequest;
  } finally {
    certificateRequest = null;
  }
}

async function verifyJwtSignature(encodedHeader, encodedPayload, encodedSignature, keyId) {
  let certificates = await getSigningCertificates();
  let certificate = certificates[keyId];

  // A token can arrive immediately after Google rotates its signing key.
  if (!certificate) {
    certificates = await getSigningCertificates(true);
    certificate = certificates[keyId];
  }
  if (typeof certificate !== "string") return false;

  try {
    const publicKey = createPublicKey(certificate);
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
    const signature = Buffer.from(encodedSignature, "base64url");
    return verifySignature("RSA-SHA256", signingInput, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Verify a Firebase Authentication ID token using Google's rotating public
 * signing certificates and the Firebase project-specific JWT claims.
 *
 * This validates token authenticity and project audience/issuer. It does not
 * check revocation/disabled-user state; use the Firebase Admin SDK with
 * checkRevoked=true for sensitive operations that require that guarantee.
 */
export async function verifyFirebaseBearerToken(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authorization !== "string" || !/^Bearer\s/i.test(authorization)) {
    return unauthorized();
  }

  const idToken = authorization.slice(7).trim();
  if (!idToken || idToken.length > 10000 || /\s/.test(idToken)) {
    return unauthorized();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== PROJECT_ID) {
    return {
      ok: false,
      status: 503,
      error: "Firebase authentication is not configured",
    };
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) return unauthorized();

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedPayload);

  if (
    !header ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid) ||
    !claims ||
    typeof claims !== "object" ||
    Array.isArray(claims)
  ) {
    return unauthorized();
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== "string" ||
    claims.sub.length < 1 ||
    claims.sub.length > 128 ||
    !Number.isInteger(claims.exp) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.auth_time) ||
    claims.exp <= now ||
    claims.exp <= claims.iat ||
    claims.iat > now + CLOCK_SKEW_SECONDS ||
    claims.auth_time > now + CLOCK_SKEW_SECONDS ||
    claims.auth_time > claims.iat ||
    !claims.firebase ||
    typeof claims.firebase !== "object"
  ) {
    return unauthorized();
  }

  let signatureIsValid;
  try {
    signatureIsValid = await verifyJwtSignature(
      encodedHeader,
      encodedPayload,
      encodedSignature,
      header.kid,
    );
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Authentication service unavailable",
    };
  }

  if (!signatureIsValid) return unauthorized();

  return {
    ok: true,
    user: {
      uid: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: claims.email_verified === true,
      displayName: typeof claims.name === "string" ? claims.name : null,
    },
  };
}
