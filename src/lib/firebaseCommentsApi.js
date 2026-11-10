// Browser adapter for authenticated shared-book/shelf discussions.
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
export class FirebaseCommentsApiError extends Error {
  constructor(message, status, payload = null) {
    super(message); this.name = "FirebaseCommentsApiError"; this.status = status; this.payload = payload;
  }
}
export function createFirebaseCommentsApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function request(path, { method = "GET", body } = {}) {
    const token = await getToken();
    if (typeof token !== "string" || !token) throw new FirebaseCommentsApiError("Sign in to use discussions.", 401);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const options = { method, headers, cache: "no-store" };
    if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
    const response = await fetchImpl(path, options);
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) throw new FirebaseCommentsApiError(
      typeof payload?.error === "string" ? payload.error : `Comments request failed (HTTP ${response.status})`,
      response.status, payload,
    );
    if (!payload || typeof payload !== "object") throw new FirebaseCommentsApiError("Comments service returned an invalid response.", 502);
    return payload;
  }
  async function listComments({ targetKind, targetId, ownerUid, limit = 50 }) {
    if (!["book", "shelf"].includes(targetKind)) throw new TypeError("Target must be a book or shelf");
    validId(targetId, "target ID"); validId(ownerUid, "owner ID");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Comment page size must be between 1 and 100");
    const params = new URLSearchParams({ targetKind, targetId, ownerUid, limit: String(limit) });
    const payload = await request(`/api/comments?${params.toString()}`);
    if (!Array.isArray(payload.records)) throw new FirebaseCommentsApiError("Comments service returned an invalid discussion.", 502, payload);
    return payload;
  }
  async function createComment({ targetKind, targetId, ownerUid, body, parentId = null }) {
    if (!["book", "shelf"].includes(targetKind)) throw new TypeError("Target must be a book or shelf");
    validId(targetId, "target ID"); validId(ownerUid, "owner ID");
    if (typeof body !== "string" || !body.trim() || body.length > 2000) throw new TypeError("Comment must be 1 to 2000 characters");
    const payload = await request("/api/comments", {
      method: "POST", body: { targetKind, targetId, ownerUid, body, ...(parentId ? { parentId: validId(parentId, "parent comment ID") } : {}) },
    });
    if (typeof payload.id !== "string" || typeof payload.authorUid !== "string") {
      throw new FirebaseCommentsApiError("Comments service returned an invalid comment.", 502, payload);
    }
    return payload;
  }
  async function deleteComment(commentId) {
    validId(commentId, "comment ID");
    return request(`/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
  }
  async function reportComment(commentId, reason) {
    validId(commentId, "comment ID");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new TypeError("A report reason is required");
    return request(`/api/comments/${encodeURIComponent(commentId)}/report`, { method: "POST", body: { reason } });
  }
  return Object.freeze({ listComments, createComment, deleteComment, reportComment });
}
export const firebaseCommentsApi = createFirebaseCommentsApi();
