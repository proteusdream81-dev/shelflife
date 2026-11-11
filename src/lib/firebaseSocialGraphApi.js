
async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}

function validId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || value.includes("/")) {
    throw new TypeError(`A valid ${label} is required`);
  }
  return value;
}

function validRelationshipId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("A valid relationship ID is required");
  }
  return value;
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
  /** @param {string} path @param {{ method?: string, body?: unknown }} [options] */
  async function request(path, { method = "GET", body } = {}) {
    const token = await getToken();
    if (typeof token !== "string" || !token) throw new FirebaseSocialGraphApiError("Sign in to view your Reading Circle.", 401);
    const headers = /** @type {Record<string, string>} */ ({ Authorization: `Bearer ${token}`, Accept: "application/json" });
    const options = /** @type {RequestInit} */ ({ method, cache: "no-store", headers });
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(path, options);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new FirebaseSocialGraphApiError(
      typeof payload?.error === "string" ? payload.error : `Reading Circle request failed (HTTP ${response.status})`,
      response.status, payload,
    );
    if (!payload || typeof payload !== "object") throw new FirebaseSocialGraphApiError("Reading Circle service returned an invalid response.", 502);
    return payload;
  }

  async function listRelationships(direction, { limit = 100, cursor = null } = {}) {
    if (!["following", "followers"].includes(direction)) throw new TypeError("Invalid relationship direction");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Page size must be between 1 and 100");
    const params = new URLSearchParams({ direction, limit: String(limit) });
    if (cursor !== null) params.set("cursor", validRelationshipId(cursor));
    const payload = await request(`/api/relationships?${params.toString()}`);
    if (!Array.isArray(payload.records)) throw new FirebaseSocialGraphApiError("Reading Circle service returned invalid records.", 502, payload);
    return payload;
  }

  /** @param {{ email?: string, username?: string }} [searchOptions] */
  async function searchReaders(searchOptions = {}) {
    const { email, username } = searchOptions;
    const exactEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const exactUsername = typeof username === "string" ? username.trim().replace(/^@+/, "").toLowerCase() : "";
    if (Boolean(exactEmail) === Boolean(exactUsername)) {
      throw new TypeError("Provide either an exact email or an exact username");
    }
    const params = new URLSearchParams(exactEmail ? { email: exactEmail } : { username: exactUsername });
    const payload = await request(`/api/relationships?${params.toString()}`);
    if (!Array.isArray(payload.readers)) throw new FirebaseSocialGraphApiError("Reading Circle search returned invalid records.", 502, payload);
    return payload;
  }

  async function checkUsernameAvailability(username) {
    const exactUsername = typeof username === "string"
      ? username.trim().replace(/^@+/, "").toLowerCase() : "";
    if (!/^[a-z0-9_]{3,20}$/.test(exactUsername)) {
      throw new TypeError("A username is 3-20 letters, numbers or underscores");
    }
    const params = new URLSearchParams({ checkUsername: exactUsername });
    const payload = await request(`/api/relationships?${params.toString()}`);
    if (payload.username !== exactUsername || typeof payload.available !== "boolean") {
      throw new FirebaseSocialGraphApiError("Username availability returned an invalid response.", 502, payload);
    }
    return payload;
  }

  async function followReader(uid) {
    validId(uid, "reader ID");
    return request("/api/relationships", { method: "POST", body: { followingUid: uid } });
  }

  async function acceptFollowRequest(relationshipId) {
    validRelationshipId(relationshipId);
    return request(`/api/relationships/${encodeURIComponent(relationshipId)}`, { method: "PATCH" });
  }

  async function removeFollowRelationship(relationshipId) {
    validRelationshipId(relationshipId);
    return request(`/api/relationships/${encodeURIComponent(relationshipId)}`, { method: "DELETE" });
  }

  async function blockReader(uid) {
    validId(uid, "reader ID");
    return request("/api/blocks", { method: "POST", body: { blockedUid: uid } });
  }

  async function unblockReader(uid) {
    validId(uid, "reader ID");
    return request(`/api/blocks/${encodeURIComponent(uid)}`, { method: "DELETE" });
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

  return Object.freeze({
    listRelationships, listCircle, searchReaders, checkUsernameAvailability, followReader, acceptFollowRequest,
    removeFollowRelationship, blockReader, unblockReader,
  });
}

export const firebaseSocialGraphApi = createFirebaseSocialGraphApi();
