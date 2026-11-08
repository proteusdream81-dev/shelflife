const FIREBASE_IDENTITY_LOOKUP =
  "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

const PROJECT_ID = "shelflife-tbr-9754d";

export async function verifyFirebaseBearerToken(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const idToken = authorization.slice(7).trim();
  if (!idToken || idToken.length > 10000 || /\s/.test(idToken)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!apiKey || projectId !== PROJECT_ID) {
    return { ok: false, status: 503, error: "Firebase authentication is not configured" };
  }

  let response;
  try {
    response = await fetch(`${FIREBASE_IDENTITY_LOOKUP}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, status: 502, error: "Authentication service unavailable" };
  }

  if (!response.ok) {
    // Firebase reports invalid/expired ID tokens as client errors.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { ok: false, status: 502, error: "Authentication service unavailable" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, error: "Authentication service unavailable" };
  }

  const account = Array.isArray(payload.users) ? payload.users[0] : null;
  if (!account?.localId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return {
    ok: true,
    user: {
      uid: account.localId,
      email: typeof account.email === "string" ? account.email : null,
      emailVerified: account.emailVerified === true,
      displayName: typeof account.displayName === "string" ? account.displayName : null,
    },
  };
}
