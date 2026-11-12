import { getFirebaseAdminAuthProjectConfig } from "./firebaseAuth.js";

const PREVIEW_BRANCH = "migration/firebase-profile-bridge";
const DEVELOPMENT_PROJECT = "shelflife-tbr-dev";

export function createFirebaseAuthConfigDiagnostic({ getConfig = getFirebaseAdminAuthProjectConfig } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (
      process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH ||
      process.env.FIREBASE_PROJECT_ID !== DEVELOPMENT_PROJECT
    ) {
      return res.status(404).json({ error: "Diagnostic not available" });
    }
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
      return res.status(400).json({ error: "This diagnostic accepts no caller-supplied data" });
    }

    try {
      const config = await getConfig();
      if (config?.projectId !== DEVELOPMENT_PROJECT) {
        throw new Error("Firebase Auth diagnostic returned an unexpected project");
      }
      return res.status(200).json({
        ok: true,
        projectId: config.projectId,
        authConfigReadable: true,
        previewDomainAuthorized: config.previewDomainAuthorized,
        googleProviderConfigured: config.googleProviderConfigured,
        googleProviderEnabled: config.googleProviderEnabled,
        googleClientIdPresent: config.googleClientIdPresent,
        googleClientIdMatchesApp: config.googleClientIdMatchesApp,
      });
    } catch (error) {
      const code = typeof error?.code === "string" || typeof error?.code === "number"
        ? String(error.code).slice(0, 80)
        : null;
      const errorType = typeof error?.name === "string" ? error.name.slice(0, 80) : "Error";
      const stage = typeof error?.diagnosticStage === "string" ? error.diagnosticStage : "project-config";
      const returnedProjectId = typeof error?.returnedProjectId === "string"
        && /^[a-z0-9-]{1,40}$/.test(error.returnedProjectId)
        ? error.returnedProjectId
        : null;
      console.error("[firebase-auth-config-diagnostic] read failed", { code, errorType, stage, returnedProjectId });
      return res.status(503).json({
        ok: false,
        projectId: DEVELOPMENT_PROJECT,
        authConfigReadable: false,
        error: "Development Firebase Auth configuration could not be read",
        code,
        errorType,
        stage,
        returnedProjectId,
      });
    }
  };
}

export default createFirebaseAuthConfigDiagnostic();
