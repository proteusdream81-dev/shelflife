// Browser adapter for the normalized Firebase book-group APIs.
// Not wired into active routes until Firebase auth/account linking is enabled.
async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}
function validId(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 1500 || value.includes("/")) {
    throw new TypeError(`A valid ${field} is required`);
  }
  return value;
}
export class FirebaseGroupApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "FirebaseGroupApiError";
    this.status = status;
    this.payload = payload;
  }
}
export function createFirebaseGroupApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  if (typeof getToken !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("Firebase token and fetch providers are required");
  }
  async function request(path, { method = "GET", body } = {}) {
    const token = await getToken();
    if (typeof token !== "string" || !token) throw new FirebaseGroupApiError("Sign in to access book groups.", 401);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const options = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(path, options);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new FirebaseGroupApiError(
      typeof payload?.error === "string" ? payload.error : `Book group request failed (HTTP ${response.status})`,
      response.status, payload,
    );
    if (!payload || typeof payload !== "object") throw new FirebaseGroupApiError("The group service returned an invalid response.", 502);
    return payload;
  }
  async function listGroups({ scope = "mine", limit = 50, cursor = null } = {}) {
    if (!["mine", "public", "invited"].includes(scope)) throw new TypeError("Unsupported group scope");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Page size must be between 1 and 100");
    const params = new URLSearchParams({ scope, limit: String(limit) });
    if (cursor !== null) params.set("cursor", validId(cursor, "group cursor"));
    const payload = await request(`/api/groups?${params.toString()}`);
    if (payload.scope !== scope || !Array.isArray(payload.records)) throw new FirebaseGroupApiError("The group service returned an invalid group list.", 502, payload);
    return payload;
  }
  async function createGroup(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Group details are required");
    const payload = await request("/api/groups", { method: "POST", body: input });
    if (typeof payload.id !== "string" || typeof payload.ownerUid !== "string") throw new FirebaseGroupApiError("The group service returned an invalid group.", 502, payload);
    return payload;
  }
  async function inviteReader(groupId, inviteeUid) {
    validId(groupId, "group ID"); validId(inviteeUid, "reader ID");
    const params = new URLSearchParams({ id: groupId });
    return request(`/api/groups/invites?${params.toString()}`, { method: "POST", body: { inviteeUid } });
  }
  async function respondToInvite(groupId, inviteId, decision) {
    validId(groupId, "group ID"); validId(inviteId, "invitation ID");
    if (!["accept", "decline"].includes(decision)) throw new TypeError("Decision must be accept or decline");
    const params = new URLSearchParams({ id: groupId, inviteId });
    return request(`/api/groups/invites?${params.toString()}`, { method: "PATCH", body: { decision } });
  }
  async function getGroupRoster(groupId) {
    validId(groupId, "group ID");
    const params = new URLSearchParams({ id: groupId });
    const payload = await request(`/api/groups/members?${params.toString()}`);
    if (payload.groupId !== groupId || !Array.isArray(payload.members) || !Array.isArray(payload.pending)) {
      throw new FirebaseGroupApiError("The group service returned an invalid roster.", 502, payload);
    }
    return payload;
  }
  async function removeReader(groupId, uid) {
    validId(groupId, "group ID"); validId(uid, "reader ID");
    const params = new URLSearchParams({ id: groupId, uid });
    return request(`/api/groups/members?${params.toString()}`, { method: "DELETE" });
  }
  async function leaveGroup(groupId) {
    validId(groupId, "group ID");
    const params = new URLSearchParams({ id: groupId, action: "leave" });
    return request(`/api/groups/membership?${params.toString()}`, { method: "DELETE" });
  }
  async function closeGroup(groupId) {
    validId(groupId, "group ID");
    const params = new URLSearchParams({ id: groupId, action: "close" });
    return request(`/api/groups/membership?${params.toString()}`, { method: "DELETE" });
  }
  return Object.freeze({ listGroups, createGroup, inviteReader, respondToInvite, getGroupRoster, removeReader, leaveGroup, closeGroup });
}
export const firebaseGroupApi = createFirebaseGroupApi();
