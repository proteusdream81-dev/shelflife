import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";

const PREVIEW_BRANCHES = new Set(["migration/firebase-profile-bridge", "migration/base44-session-bridge"]);
const PROJECT_ID = "shelflife-tbr-dev";
const PROJECT_NUMBER = "1011106075373";
const SERVICE_ACCOUNT_EMAIL =
  "shelf-preview-auth-dev@shelflife-tbr-dev.iam.gserviceaccount.com";
const POOL_ID = "vercel-preview-dev";
const PROVIDER_ID = "shelflife-preview-dev";

if (
  process.env.VERCEL_ENV !== "preview" ||
  !PREVIEW_BRANCHES.has(process.env.VERCEL_GIT_COMMIT_REF)
) {
  process.exit(0);
}

function reportNotReady(reason) {
  console.warn(`[shelflife-wif] Preview federation not verified: ${reason}`);
}

const configurationMatches =
  process.env.FIREBASE_PROJECT_ID === PROJECT_ID &&
  process.env.GCP_PROJECT_NUMBER === PROJECT_NUMBER &&
  process.env.GCP_SERVICE_ACCOUNT_EMAIL === SERVICE_ACCOUNT_EMAIL &&
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID === POOL_ID &&
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID === PROVIDER_ID;

if (!configurationMatches) {
  reportNotReady("development project or WIF environment variables do not match");
  process.exit(0);
}

try {
  const audience =
    `//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}`;
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken(),
    },
  });

  if (!client) throw new Error("external account client unavailable");
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google did not return an access token");

  console.log(
    "[shelflife-wif] Verified Vercel Preview OIDC exchange to the dev-only Google service account.",
  );
} catch (error) {
  const reason =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.name === "string"
        ? error.name
        : "unknown";
  reportNotReady(reason);
}
