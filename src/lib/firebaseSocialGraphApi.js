async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}
export class FirebaseSocialGraphApiError extends Error {
  constructor(message, status, payload = null) {
    super(message); this.name = "FirebaseSocialGraphApiError"; this.status = status; this.payload = payload;
  }
}
/** @param {{ getToken?: () => Promise<string>, fetchImpl?: typeof fetch }} [options] */
export function createFirebaseSocialGraphApi({
  getToken = defaultGetToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  async function listRelationships(direction, { limit = 100, cursor = null } = {}) {
    if (!["following", "followers"].includes(direction)) throw new TypeError("Invalid relationship direction");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Page size must be between 1 and 100");
    const token = await getToken();
    if (typeof token !== "string" || !token) throw new FirebaseSocialGraphApiError("Sign in to view your Reading Circle.", 401);
    const params = new URLSearchParams({ direction, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    const response = await fetchImpl(`/api/relationships?${params.toString()}`, {
      method: "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new FirebaseSocialGraphApiError(
      typeof payload?.error === "string" ? payload.error : `Reading Circle request failed (HTTP ${response.status})`,
      response.status, payload,
    );
    if (!Array.isArray(payload?.records)) throw new FirebaseSocialGraphApiError("Reading Circle service returned invalid records.", 502, payload);
    return payload;
  }
  async function listCircle() {
    const [following, followers] = await Promise.all([
      listRelationships("following", { limit: 100 }),
      listRelationships("followers", { limit: 100 }),
    ]);
    const seen = new Set();
    return [...following.records, ...followers.records]
      .filter((record) => record.status === "accepted" && typeof record.readerUid === "string" &&
        !seen.has(record.readerUid) && seen.add(record.readerUid))
      .map((record) => ({ id: record.readerUid, name: record.displayName || "Reader" }));
  }
  return Object.freeze({ listRelationships, listCircle });
}
export const firebaseSocialGraphApi = createFirebaseSocialGraphApi();