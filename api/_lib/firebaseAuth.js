import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = "shelflife-tbr-9754d";
const APP_NAME = "shelflife-server-auth";

let adminAuthPromise;

function unauthorized() {
  return { ok: false, status: 401, error: "Unauthorized" };
}

function getBearerToken(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authorization !== "string" || !/^Bearer\s/i.test(authorization)) {
    return null;
  }
  const token = authorization.slice(7).trim();
  if (!token || token.length > 10000 || /\s/.test(token)) return null;
  return token;
}

function parseServiceAccount(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.type !== "service_account" ||
      parsed.project_id !== PROJECT_ID ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getFirebaseAdminAuth() {
  if (adminAuthPromise) return adminAuthPromise;

  adminAuthPromise = (async () => {
    if (process.env.FIREBASE_PROJECT_ID !== PROJECT_ID) {
      throw new Error("Firebase Admin project is not configured");
    }

    const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!serviceAccount) {
      throw new Error("Firebase Admin service account is not configured");
    }

    const existing = getApps().find((app) => app.name === APP_NAME);
    const app = existing || initializeApp({
      credential: cert(serviceAccount),
      projectId: PROJECT_ID,
    }, APP_NAME);
    return getAuth(app);
  })();

  try {
    return await adminAuthPromise;
  } catch (error) {
    adminAuthPromise = null;
    throw error;
  }
}

/**
 * Verify a Firebase ID token with the Admin SDK and check revocation and
 * disabled-user state. The service-account JSON is server-only and must
 * never use a VITE_ prefix or be exposed to browser code.
 *
 * The optional auth argument is for deterministic unit tests only.
 */
export async function verifyFirebaseBearerToken(req, { auth } = {}) {
  const token = getBearerToken(req);
  if (!token) return unauthorized();

  if (process.env.FIREBASE_PROJECT_ID !== PROJECT_ID) {
    return {
      ok: false,
      status: 503,
      error: "Firebase authentication is not configured",
    };
  }

  let firebaseAuth;
  try {
    firebaseAuth = auth || await getFirebaseAdminAuth();
    const decoded = await firebaseAuth.verifyIdToken(token, true);

    if (
      decoded.aud !== PROJECT_ID ||
      decoded.iss !== \`https://securetoken.google.com/\${PROJECT_ID}\` ||
      typeof decoded.uid !== "string" ||
      !decoded.uid ||
      decoded.uid.length > 128
    ) return unauthorized();

    return {
      ok: true,
      user: {
        uid: decoded.uid,
        email: typeof decoded.email === "string" ? decoded.email : null,
        emailVerified: decoded.email_verified === true,
        displayName: typeof decoded.name === "string" ? decoded.name : null,
      },
    };
  } catch (error) {
    const code = error?.code;
    if (
      code === "auth/id-token-expired" ||
      code === "auth/id-token-revoked" ||
      code === "auth/invalid-id-token" ||
      code === "auth/argument-error" ||
      code === "auth/user-disabled" ||
      code === "auth/user-not-found"
    ) return unauthorized();

    return {
      ok: false,
      status: 503,
      error: "Authentication service unavailable",
    };
  }
}
