// Client adapter for the guarded Firebase owner-library API.
// This module is intentionally not wired into the active Base44 AuthContext or UI.
// It becomes usable only after Firebase sign-in and a verified legacy identity link exist.

async function defaultGetToken() {
  const { getFirebaseIdToken } = await import("./firebaseAuth.js");
  return getFirebaseIdToken();
}

function requireRecordId(id) {
  if (typeof id !== "string" || !id.trim() || id.length > 1500 || id.includes("/")) {
    throw new TypeError("A valid library record ID is required");
  }
  return id;
}

function requireVersion(version) {
  if (typeof version !== "string" || !version.trim() || version.length > 128) {
    throw new TypeError("Reload this record before saving changes");
  }
  return version;
}

function requireObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.getPrototypeOf(data) !== Object.prototype || Object.keys(data).length === 0) {
    throw new TypeError("A non-empty record object is required");
  }
  return data;
}

export class FirebaseLibraryApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "FirebaseLibraryApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function createFirebaseLibraryApi({
  getToken = defaultGetToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  if (typeof getToken !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("Firebase token and fetch providers are required");
  }

  async function request(path, { method = "GET", body, version } = {}) {
    const token = await getToken();
    if (typeof token !== "string" || !token) {
      throw new FirebaseLibraryApiError("You must be signed in to access your library.", 401);
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    const options = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(requireObject(body));
    }
    if (version !== undefined) headers["If-Match"] = requireVersion(version);

    const response = await fetchImpl(path, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = typeof payload?.error === "string"
        ? payload.error
        : `Library request failed (HTTP ${response.status})`;
      throw new FirebaseLibraryApiError(message, response.status, payload);
    }
    if (!payload || typeof payload !== "object") {
      throw new FirebaseLibraryApiError("The library service returned an invalid response.", 502);
    }
    return payload;
  }

  function collectionPath(collection, { limit = 50, cursor = null } = {}) {
    if (!["books", "shelves"].includes(collection)) throw new TypeError("Unsupported library collection");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Page size must be between 1 and 100");
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor !== null) {
      if (typeof cursor !== "string" || !cursor || cursor.length > 1500 || cursor.includes("/")) {
        throw new TypeError("Invalid library pagination cursor");
      }
      params.set("cursor", cursor);
    }
    return `/api/library/${collection}?${params.toString()}`;
  }

  async function list(collection, options) {
    const payload = await request(collectionPath(collection, options));
    if (!Array.isArray(payload.records) || typeof payload.nextCursor !== "string" && payload.nextCursor !== null) {
      throw new FirebaseLibraryApiError("The library service returned an invalid page.", 502, payload);
    }
    return payload;
  }

  async function create(collection, data) {
    const payload = await request(`/api/library/${collection}`, {
      method: "POST",
      body: requireObject(data),
    });
    if (!payload.record || typeof payload.record.id !== "string" || typeof payload.record.version !== "string") {
      throw new FirebaseLibraryApiError("The library service returned an invalid created record.", 502, payload);
    }
    return payload.record;
  }

  async function update(collection, record, changes) {
    const id = requireRecordId(record?.id);
    const version = requireVersion(record?.version);
    const payload = await request(`/api/library/${collection}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: requireObject(changes),
      version,
    });
    if (!payload.record || payload.record.id !== id || typeof payload.record.version !== "string") {
      throw new FirebaseLibraryApiError("The library service returned an invalid updated record.", 502, payload);
    }
    return payload.record;
  }

  return Object.freeze({
    listBooks: (options) => list("books", options),
    listShelves: (options) => list("shelves", options),
    createBook: (data) => create("books", data),
    updateBook: (record, changes) => update("books", record, changes),
    createShelf: (data) => create("shelves", data),
    updateShelf: (record, changes) => update("shelves", record, changes),
  });
}

export const firebaseLibraryApi = createFirebaseLibraryApi();
