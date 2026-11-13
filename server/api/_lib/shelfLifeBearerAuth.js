import { createHash } from "node:crypto";
import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import { verifyBase44Session, InvalidBase44SessionError } from "./base44Session.js";

function getBearerToken(req) {
  const authorization = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof authorization !== "string" || !/^Bearer\s/i.test(authorization)) return null;
  const token = authorization.slice(7).trim();
  return token && token.length <= 10000 && !/\s/.test(token) ? token : null;
}

function validIdentityId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value !== "." && value !== ".." && !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Resolve a legacy Base44 session only when it maps through an already verified,
 * reciprocal Firebase identity link. This does not create links or Firebase users.
 *
 * A verified reciprocal link is evidence that the Firebase identity was verified
 * at link time; no email address or identity ID is exposed to the caller.
 */
export async function resolveVerifiedBase44Principal({
  token,
  verifyLegacySession = verifyBase44Session,
  getDb = getFirebaseAdminFirestore,
}) {
  const base44User = await verifyLegacySession(token);
  if (!validIdentityId(base44User?.id)) {
    throw new InvalidBase44SessionError();
  }

  const db = await getDb();
  const reverseSnapshot = await db.collection("legacyIdentityLinks").doc(base44User.id).get();
  const reverse = reverseSnapshot.exists ? reverseSnapshot.data() : null;
  if (reverse?.status !== "verified") {
    throw new InvalidBase44SessionError();
  }

  const firebaseUid = reverse.firestoreUid || reverse.firebaseUid;
  if (!validIdentityId(firebaseUid)) throw new InvalidBase44SessionError();
  if (reverse.firestoreUid) {
    const expectedUid = `b44_${createHash("sha256").update(`shelflife-base44-v1:${base44User.id}`).digest("hex")}`;
    if (reverse.authProvider !== "base44" || firebaseUid !== expectedUid) {
      throw new InvalidBase44SessionError();
    }
  }
  const forwardSnapshot = await db.collection("identityLinks").doc(firebaseUid).get();
  const forward = forwardSnapshot.exists ? forwardSnapshot.data() : null;
  if (
    forward?.status !== "verified" ||
    forward?.base44UserId !== base44User.id ||
    (reverse.firestoreUid && forward?.authProvider !== "base44")
  ) {
    throw new InvalidBase44SessionError();
  }

  return {
    uid: firebaseUid,
    email: typeof base44User.email === "string" ? base44User.email : null,
    emailVerified: base44User.emailVerified === true,
    displayName: typeof base44User.displayName === "string" ? base44User.displayName : null,
  };
}

/**
 * Accept either a valid Firebase ID token or an existing Base44 session whose
 * identity has already been dual-verified and linked. Firebase remains preferred.
 */
export function createShelfLifeBearerVerifier({
  verifyFirebaseToken = verifyFirebaseBearerToken,
  verifyLegacySession = verifyBase44Session,
  getDb = getFirebaseAdminFirestore,
  allowLegacyFallback = () => process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/base44-session-bridge",
} = {}) {
  return async function verifyShelfLifeBearerToken(req) {
    const firebaseResult = await verifyFirebaseToken(req);
    if (firebaseResult?.ok || firebaseResult?.status !== 401) return firebaseResult;
    if (!allowLegacyFallback()) return firebaseResult;

    const token = getBearerToken(req);
    if (!token) return firebaseResult;

    try {
      const user = await resolveVerifiedBase44Principal({
        token,
        verifyLegacySession,
        getDb,
      });
      return { ok: true, user, identityProvider: "base44-verified-link" };
    } catch (error) {
      if (error instanceof InvalidBase44SessionError) {
        return { ok: false, status: 401, error: "Unauthorized" };
      }
      console.error("[shelflife-auth] legacy session verification unavailable", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number"
          ? String(error.code).slice(0, 80) : null,
      });
      return { ok: false, status: 503, error: "Authentication service unavailable" };
    }
  };
}

export const verifyShelfLifeBearerToken = createShelfLifeBearerVerifier();
