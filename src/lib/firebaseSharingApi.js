// Browser adapter for owner-scoped share settings and token-based public shares.
async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}
function validId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 1500 || value.includes("/")) {
    throw new TypeError(`A valid ${label} is required`);
  }
  return value;
}
export class FirebaseSharingApiError extends Error {
  constructor(message, status, payload = null) {
    super(message); this.name = "FirebaseSharingApiError"; this.status = status; this.payload = payload;
  }
}
export function createFirebaseSharingApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function request(path, { method = "GET", body, headers = {}, authenticated = true } = {}) {
    const requestHeaders = { Accept: "application/json", ...headers };
    if (authenticated) {
      const token = await getToken();
      if (typeof token !== "string" || !token) throw new FirebaseSharingApiError("Sign in to manage sharing.", 401);
      requestHeaders.Authorization = `Bearer ${token}`;
    }
    const options = { method, headers: requestHeaders, cache: "no-store" };
    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(path, options);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new FirebaseSharingApiError(
      typeof payload?.error === "string" ? payload.error : `Sharing request failed (HTTP ${response.status})`,
      response.status, payload,
    );
    if (!payload || typeof payload !== "object") throw new FirebaseSharingApiError("Sharing service returned an invalid response.", 502);
    return payload;
  }
  async function updateShareSettings(kind, id, settings, version) {
    if (!["books", "shelves"].includes(kind)) throw new TypeError("Share target must be a book or shelf");
    validId(id, "library record ID");
    if (typeof version !== "string" || !version) throw new TypeError("A Firestore record version is required");
    const payload = await request(`/api/library/${kind}/${encodeURIComponent(id)}/sharing`, {
      method: "PATCH", body: settings, headers: { "If-Match": version },
    });
    if (typeof payload.shareEnabled !== "boolean" || !["circle", "selected"].includes(payload.shareAudience)) {
      throw new FirebaseSharingApiError("Sharing service returned invalid settings.", 502, payload);
    }
    return payload;
  }
  async function listSharedWithMe() {
    const payload = await request("/api/shared");
    if (!Array.isArray(payload.records) || typeof payload.count !== "number") {
      throw new FirebaseSharingApiError("Shared library service returned an invalid feed.", 502, payload);
    }
    return payload;
  }
  async function getPublicShare(token) {
    validId(token, "share token");
    return request(`/api/share/${encodeURIComponent(token)}`, { authenticated: false });
  }
  return Object.freeze({ updateShareSettings, listSharedWithMe, getPublicShare });
}
export const firebaseSharingApi = createFirebaseSharingApi();
