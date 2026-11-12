import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createFirestoreRestClient } from "./firestoreRest.js";

const APP_NAME = "shelflife-server-auth";

let adminAuthPromise;
let federatedClientPromise;

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

/**
 * Resolve and validate the Firebase / GCP project identity from environment.
 * Both Preview (dev) and future production must supply these explicitly.
 */
function getProjectIdentity() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const projectNumber = process.env.GCP_PROJECT_NUMBER;

  if (
    typeof projectId !== "string" ||
    !/^[a-z0-9-]{6,30}$/.test(projectId) ||
    typeof projectNumber !== "string" ||
    !/^\d{6,15}$/.test(projectNumber)
  ) {
    throw new Error("Firebase / GCP project identity is not configured");
  }

  return { projectId, projectNumber };
}

function getWorkloadIdentityConfig() {
  const { projectId, projectNumber } = getProjectIdentity();
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  // Accept any service account belonging to the configured project.
  // This supports both the production-like and the dedicated Preview/dev accounts.
  const emailPattern = new RegExp(
    `^[a-z0-9-]+@${projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\.iam\.gserviceaccount\.com$`,
  );

  if (
    !poolId ||
    !/^[a-z0-9-]{4,32}$/.test(poolId) ||
    !providerId ||
    !/^[a-z0-9-]{4,32}$/.test(providerId) ||
    !serviceAccountEmail ||
    !emailPattern.test(serviceAccountEmail)
  ) {
    throw new Error("Google workload identity is not configured");
  }

  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
  return { audience, serviceAccountEmail, projectId, projectNumber };
}

async function getFederatedClient() {
  if (!federatedClientPromise) {
    federatedClientPromise = (async () => {
      const { audience, serviceAccountEmail } = getWorkloadIdentityConfig();
      const client = ExternalAccountClient.fromJSON({
        type: "external_account",
        audience,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        token_url: "https://sts.googleapis.com/v1/token",
        service_account_impersonation_url:
          `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
        subject_token_supplier: {
          getSubjectToken: () => getVercelOidcToken(),
        },
      });
      if (!client) throw new Error("Google workload identity client could not be initialized");
      return client;
    })().catch((error) => {
      federatedClientPromise = null;
      throw error;
    });
  }
  return federatedClientPromise;
}

async function createFederatedCredential() {
  getWorkloadIdentityConfig();
  return {
    async getAccessToken() {
      const client = await getFederatedClient();
      const { token } = await client.getAccessToken();
      const expiryDate = client.credentials?.expiry_date;
      if (!token || typeof expiryDate !== "number") {
        throw new Error("Google workload identity returned an invalid access token");
      }
      return {
        access_token: token,
        expires_in: Math.max(0, Math.floor((expiryDate - Date.now()) / 1000)),
      };
    },
  };
}

async function getFirebaseAdminAuth() {
  if (adminAuthPromise) return adminAuthPromise;

  adminAuthPromise = (async () => {
    const { projectId } = getProjectIdentity();

    const existing = getApps().find((app) => app.name === APP_NAME);
    const app = existing || initializeApp({
      credential: await createFederatedCredential(),
      projectId,
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

/** Return a Firestore REST adapter authenticated by the same keyless WIF identity. */
export async function getFirebaseAdminFirestore() {
  const { projectId } = getProjectIdentity();
  await getFirebaseAdminAuth();
  return createFirestoreRestClient({
    projectId,
    getAccessToken: async () => {
      const client = await getFederatedClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error("Google workload identity returned no access token");
      return token;
    },
  });
}

/**
 * Verify a Firebase ID token with the Admin SDK and check revocation and
 * disabled-user state. Google credentials are obtained through Vercel OIDC
 * federation and short-lived service-account impersonation; no private key
 * or service-account JSON is stored in Vercel.
 *
 * The optional auth argument is for deterministic unit tests only.
 */
export async function verifyFirebaseBearerToken(req, { auth } = {}) {
  const token = getBearerToken(req);
  if (!token) return unauthorized();

  let projectId;
  try {
    projectId = getProjectIdentity().projectId;
  } catch {
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
      decoded.aud !== projectId ||
      decoded.iss !== "https://securetoken.google.com/" + projectId ||
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
