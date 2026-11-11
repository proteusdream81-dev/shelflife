
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createFirestoreRestClient } from "./firestoreRest.js";

const FIREBASE_PROJECTS = Object.freeze({
  "shelflife-tbr-9754d": {
    projectNumber: "599157455651",
    serviceAccountEmail: "shelf-preview-auth@shelflife-tbr-9754d.iam.gserviceaccount.com",
  },
  "shelflife-tbr-dev": {
    projectNumber: "1011106075373",
    serviceAccountEmail: "shelf-preview-auth-dev@shelflife-tbr-dev.iam.gserviceaccount.com",
  },
});
const APP_NAME_PREFIX = "shelflife-server-auth";

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

function getFirebaseProjectConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const projectConfig = FIREBASE_PROJECTS[projectId];
  if (!projectConfig) throw new Error("Firebase project is not configured");

  // Preview is pinned to the isolated development project and the migration
  // branch. Production is pinned to the existing production Firebase project.
  if (process.env.VERCEL_ENV === "production" && projectId !== "shelflife-tbr-9754d") {
    throw new Error("Production must use the production Firebase project");
  }
  if (
    process.env.VERCEL_ENV === "preview" &&
    (projectId !== "shelflife-tbr-dev" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "migration/firebase-profile-bridge")
  ) {
    throw new Error("Preview Firebase access is restricted to the migration branch");
  }

  return { projectId, ...projectConfig };
}

function getWorkloadIdentityConfig() {
  const { projectId, projectNumber, serviceAccountEmail: expectedServiceAccountEmail } = getFirebaseProjectConfig();
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (
    process.env.GCP_PROJECT_NUMBER !== projectNumber ||
    !poolId ||
    !/^[a-z0-9-]{4,32}$/.test(poolId) ||
    !providerId ||
    !/^[a-z0-9-]{4,32}$/.test(providerId) ||
    serviceAccountEmail !== expectedServiceAccountEmail
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
    const { projectId } = getFirebaseProjectConfig();
    const appName = `${APP_NAME_PREFIX}-${projectId}`;
    const existing = getApps().find((app) => app.name === appName);
    const app = existing || initializeApp({
      credential: await createFederatedCredential(),
      projectId,
    }, appName);
    return getAuth(app);
  })();

  try {
    return await adminAuthPromise;
  } catch (error) {
    adminAuthPromise = null;
    throw error;
  }
}

/** Return a narrowly scoped writable Firestore adapter for the one-shot Preview WIF smoke test. */
export async function getFirebaseAdminFirestoreSmokeTest() {
  const { projectId } = getFirebaseProjectConfig();
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "migration/firebase-profile-bridge" ||
    projectId !== "shelflife-tbr-dev" ||
    process.env.FIREBASE_WIF_SMOKE_TEST_ENABLED !== "true"
  ) {
    throw new Error("The development Preview WIF smoke test is not enabled");
  }
  await getFirebaseAdminAuth();
  return createFirestoreRestClient({
    projectId,
    getAccessToken: async () => {
      const client = await getFederatedClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error("Google workload identity returned no access token");
      return token;
    },
    // This adapter is exposed only to the fixed one-shot create/read/delete handler.
    // All normal application and migration clients remain read-only by default.
    readOnly: false,
  });
}

/**
 * Return a read-only Firestore adapter with a single, explicit server-side write
 * exception for top-level rate-limit documents. This is separate from the general
 * migration write flag and is disabled unless the exact Preview or Production
 * project opts in with FIREBASE_RATE_LIMITS_ENABLED=true.
 */
export async function getFirebaseAdminFirestoreRateLimits() {
  const { projectId } = getFirebaseProjectConfig();
  const previewAllowed = process.env.VERCEL_ENV === "preview" &&
    projectId === "shelflife-tbr-dev" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/firebase-profile-bridge";
  const productionAllowed = process.env.VERCEL_ENV === "production" &&
    projectId === "shelflife-tbr-9754d";
  if (process.env.FIREBASE_RATE_LIMITS_ENABLED !== "true" || !(previewAllowed || productionAllowed)) {
    throw new Error("Firebase rate-limit writes are not enabled for this deployment");
  }
  await getFirebaseAdminAuth();
  return createFirestoreRestClient({
    projectId,
    getAccessToken: async () => {
      const client = await getFederatedClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error("Google workload identity returned no access token");
      return token;
    },
    readOnly: true,
    writableCollections: ["rateLimits"],
  });
}

/** Return a Firestore REST adapter authenticated by the same keyless WIF identity. */
export async function getFirebaseAdminFirestore() {
  const { projectId } = getFirebaseProjectConfig();
  await getFirebaseAdminAuth();
  const writesEnabled =
    process.env.FIREBASE_MIGRATION_WRITES_ENABLED === "true" &&
    process.env.FIREBASE_MIGRATION_TARGET_PROJECT_ID === projectId;

  return createFirestoreRestClient({
    projectId,
    getAccessToken: async () => {
      const client = await getFederatedClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error("Google workload identity returned no access token");
      return token;
    },
    // Preview and Production are read-only by default. Mutations require two
    // explicit server-side settings that both identify this exact Firestore project.
    readOnly: !writesEnabled,
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

  let projectConfig;
  try {
    projectConfig = getFirebaseProjectConfig();
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
      decoded.aud !== projectConfig.projectId ||
      decoded.iss !== "https://securetoken.google.com/" + projectConfig.projectId ||
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
