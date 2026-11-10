// Client adapter for the authenticated Firebase group chat endpoints.
// This is intentionally separate from the Base44 actor client until the group UI cutover is approved.
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
export class FirebaseGroupChatApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "FirebaseGroupChatApiError";
    this.status = status;
    this.payload = payload;
  }
}
export function createFirebaseGroupChatApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  if (typeof getToken !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("Firebase token and fetch providers are required");
  }
  async function request(path, { method = "GET", body } = {}) {
    const token = await getToken();
    if (typeof token !== "string" || !token) throw new FirebaseGroupChatApiError("Sign in to access group chat.", 401);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const options = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(path, options);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      throw new FirebaseGroupChatApiError(
        typeof payload?.error === "string" ? payload.error : `Group chat request failed (HTTP ${response.status})`,
        response.status,
        payload,
      );
    }
    if (!payload || typeof payload !== "object") {
      throw new FirebaseGroupChatApiError("The group chat service returned an invalid response.", 502);
    }
    return payload;
  }
  async function listMessages(groupId, { limit = 50, cursor = null } = {}) {
    validId(groupId, "group ID");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Page size must be between 1 and 100");
    const params = new URLSearchParams({ groupId, limit: String(limit) });
    if (cursor !== null) params.set("cursor", validId(cursor, "message cursor"));
    const payload = await request(`/api/groups/messages?${params.toString()}`);
    if (payload.groupId !== groupId || !Array.isArray(payload.records) ||
      !(payload.nextCursor === null || typeof payload.nextCursor === "string")) {
      throw new FirebaseGroupChatApiError("The group chat service returned an invalid message page.", 502, payload);
    }
    return payload;
  }
  async function sendMessage(groupId, body) {
    validId(groupId, "group ID");
    if (typeof body !== "string" || !body.trim() || body.length > 1000) throw new TypeError("Message must be 1 to 1000 characters");
    const payload = await request("/api/groups/messages", { method: "POST", body: { groupId, body } });
    if (typeof payload.id !== "string" || typeof payload.authorUid !== "string" || typeof payload.body !== "string") {
      throw new FirebaseGroupChatApiError("The group chat service returned an invalid message.", 502, payload);
    }
    return payload;
  }
  async function deleteMessage(groupId, messageId) {
    validId(groupId, "group ID");
    validId(messageId, "message ID");
    const params = new URLSearchParams({ groupId, messageId });
    return request(`/api/groups/messages?${params.toString()}`, { method: "DELETE" });
  }
  return Object.freeze({ listMessages, sendMessage, deleteMessage });
}
export const firebaseGroupChatApi = createFirebaseGroupChatApi();
