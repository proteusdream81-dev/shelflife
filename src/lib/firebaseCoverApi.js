// Browser adapter for the staged private R2 cover Worker.
// It is intentionally not wired into BookCover or the active Base44 data flow.

async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}

function requireBook(book) {
  if (!book || typeof book.id !== "string" || !book.id || book.id.includes("/") ||
      typeof book.version !== "string" || !book.version) {
    throw new TypeError("A saved book with a current version is required");
  }
  return book;
}

function requireObjectKey(key) {
  if (typeof key !== "string" || key.length > 180 || key.includes("..") || key.includes("\\")) {
    throw new TypeError("Invalid cover object key");
  }
  const parts = key.split("/");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|webp)$/i;
  if (parts.length !== 2 || !parts[0] || !uuid.test(parts[1])) {
    throw new TypeError("Invalid cover object key");
  }
  return key;
}

function normalizeWorkerUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Private cover storage is not configured for this Preview.");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || url.port) {
    throw new Error("Private cover storage URL must be an HTTPS origin.");
  }
  return url.origin;
}

async function defaultResponse(response) {
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(typeof payload?.error === "string" ? payload.error : `Cover request failed (HTTP ${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function createFirebaseCoverApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
  workerUrl = import.meta.env?.VITE_COVER_STORAGE_URL || "",
} = {}) {
  const baseUrl = normalizeWorkerUrl(workerUrl);
  if (typeof getToken !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("Firebase token and fetch providers are required");
  }

  async function token() {
    const value = await getToken();
    if (typeof value !== "string" || !value) {
      const error = new Error("You must be signed in to manage private covers.");
      error.status = 401;
      throw error;
    }
    return value;
  }

  async function deleteObject(objectKey, idToken) {
    const key = requireObjectKey(objectKey);
    const response = await fetchImpl(`${baseUrl}/v1/covers/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
    });
    if (response.status === 204) return true;
    await defaultResponse(response);
    return true;
  }

  async function refreshReadUrl(book) {
    requireBook(book);
    if (!book.cover_storage_key) return null;
    const idToken = await token();
    const response = await fetchImpl(`${baseUrl}/v1/covers/read-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
        "X-Book-Id": book.id,
        "X-Object-Key": requireObjectKey(book.cover_storage_key),
        Accept: "application/json",
      },
    });
    const payload = await defaultResponse(response);
    if (payload.bookId !== book.id || typeof payload.readUrl !== "string") {
      throw new Error("Cover service returned an invalid read URL.");
    }
    return payload.readUrl;
  }

  async function uploadCover(book, file) {
    requireBook(book);
    if (!file || typeof file.size !== "number" || typeof file.type !== "string") {
      throw new TypeError("A JPEG, PNG or WebP image file is required");
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      throw new RangeError("Cover image must be between 1 byte and 5 MiB");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())) {
      throw new TypeError("Only JPEG, PNG and WebP cover images are accepted");
    }

    const idToken = await token();
    const uploadedResponse = await fetchImpl(`${baseUrl}/v1/covers`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "X-Book-Id": book.id,
        "Content-Type": file.type.toLowerCase(),
      },
      body: file,
    });
    const uploaded = await defaultResponse(uploadedResponse);
    const newKey = requireObjectKey(uploaded.objectKey);
    if (uploaded.bookId !== book.id || typeof uploaded.readUrl !== "string") {
      await deleteObject(newKey, idToken).catch(() => {});
      throw new Error("Cover service returned an invalid upload response.");
    }

    let saved;
    try {
      const saveResponse = await fetchImpl(`/api/library/books/${encodeURIComponent(book.id)}/cover`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "If-Match": book.version,
        },
        body: JSON.stringify({ objectKey: newKey }),
      });
      const savedPayload = await defaultResponse(saveResponse);
      if (!savedPayload.record || savedPayload.record.id !== book.id ||
          savedPayload.record.cover_storage_key !== newKey || typeof savedPayload.record.version !== "string") {
        throw new Error("Library service returned an invalid saved cover record.");
      }
      saved = savedPayload.record;
    } catch (error) {
      // Avoid orphaning a newly uploaded object if the Firestore pointer did not commit.
      await deleteObject(newKey, idToken).catch(() => {});
      throw error;
    }

    let cleanupWarning = false;
    if (book.cover_storage_key && book.cover_storage_key !== newKey) {
      await deleteObject(book.cover_storage_key, idToken).catch(() => { cleanupWarning = true; });
    }
    return { record: saved, readUrl: uploaded.readUrl, cleanupWarning };
  }

  return Object.freeze({ refreshReadUrl, uploadCover, deleteObject });
}

export const firebaseCoverApi = Object.freeze({
  refreshReadUrl: (...args) => createFirebaseCoverApi().refreshReadUrl(...args),
  uploadCover: (...args) => createFirebaseCoverApi().uploadCover(...args),
  deleteObject: (...args) => createFirebaseCoverApi().deleteObject(...args),
});
