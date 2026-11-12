const DATABASE_ID = "(default)";
const QUERYABLE_FIELDS = new Set(["created_by_id"]);

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function encodeString(value) {
  return { stringValue: value };
}

function validCollectionName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
}

function validDocumentId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1500 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/");
}

function encodePath(segments) {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function snapshotFromDocument(document, fallbackId) {
  return {
    exists: Boolean(document?.name),
    id: document?.name?.split("/").pop() || fallbackId,
    data: () => decodeFields(document?.fields || {}),
  };
}

function snapshotFromQuery(result = []) {
  const docs = (Array.isArray(result) ? result : [])
    .filter((item) => item.document?.name)
    .map((item) => {
      const document = item.document;
      return {
        id: document.name.split("/").pop(),
        data: () => decodeFields(document.fields || {}),
      };
    });
  return { docs, size: docs.length, empty: docs.length === 0 };
}

/**
 * Create a minimal Firestore REST client.
 * projectId must be supplied by the caller (normally the same identity
 * resolved by firebaseAuth.getProjectIdentity).
 */
export function createFirestoreRestClient({ projectId, getAccessToken, fetchImpl = fetch }) {
  if (typeof projectId !== "string" || !/^[a-z0-9-]{6,30}$/.test(projectId)) {
    throw new TypeError("A valid Firebase projectId is required");
  }
  if (typeof getAccessToken !== "function") throw new TypeError("A Google access-token provider is required");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

  const API_ROOT = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents`;

  async function request(url, options = {}) {
    const token = await getAccessToken();
    if (typeof token !== "string" || !token) throw new Error("Google workload identity returned no access token");
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `Firestore request failed with HTTP ${response.status}`);
      error.code = body.error?.status || response.status;
      throw error;
    }
    return body;
  }

  function makeCollection(pathSegments) {
    const segments = [...pathSegments];
    const collectionName = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);
    const parentUrl = parentSegments.length
      ? `${API_ROOT}/${encodePath(parentSegments)}`
      : API_ROOT;

    function validateLimit(maximum) {
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) {
        throw new TypeError("Firestore query limit must be between 1 and 100");
      }
    }

    async function runQuery({ fieldFilter = null, maximum = 50, startAfterId = null } = {}) {
      validateLimit(maximum);

      const structuredQuery = {
        from: [{ collectionId: collectionName }],
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: maximum,
      };
      if (fieldFilter) structuredQuery.where = { fieldFilter };
      if (startAfterId !== null) {
        if (!validDocumentId(startAfterId)) throw new TypeError("Invalid Firestore cursor");
        structuredQuery.startAt = {
          before: false,
          values: [{
            referenceValue: `projects/${projectId}/databases/${DATABASE_ID}/documents/${encodePath([...segments, startAfterId])}`,
          }],
        };
      }

      const result = await request(`${parentUrl}:runQuery`, {
        method: "POST",
        body: JSON.stringify({ structuredQuery }),
      });
      return snapshotFromQuery(result);
    }

    return {
      doc(documentId) {
        if (!validDocumentId(documentId)) throw new TypeError("Invalid Firestore document ID");
        const documentSegments = [...segments, documentId];
        return {
          async get() {
            let document;
            try {
              document = await request(`${API_ROOT}/${encodePath(documentSegments)}`);
            } catch (error) {
              if (error?.code === "NOT_FOUND" || error?.code === 404) {
                return { exists: false, id: documentId, data: () => null };
              }
              throw error;
            }
            return snapshotFromDocument(document, documentId);
          },
          collection(subcollectionName) {
            if (!validCollectionName(subcollectionName)) throw new TypeError("Invalid Firestore collection name");
            return makeCollection([...documentSegments, subcollectionName]);
          },
        };
      },

      limit(maximum) {
        validateLimit(maximum);
        return {
          startAfter(documentId) {
            return {
              get: () => runQuery({ maximum, startAfterId: documentId }),
            };
          },
          get: () => runQuery({ maximum }),
        };
      },

      where(field, operator, value) {
        if (!QUERYABLE_FIELDS.has(field) || operator !== "==" || typeof value !== "string" || value.length > 128) {
          throw new TypeError("Unsupported Firestore query");
        }
        return {
          limit(maximum) {
            validateLimit(maximum);
            return {
              get: () => runQuery({
                fieldFilter: {
                  field: { fieldPath: field },
                  op: "EQUAL",
                  value: encodeString(value),
                },
                maximum,
              }),
            };
          },
        };
      },
    };
  }

  return {
    collection(collectionName) {
      if (!validCollectionName(collectionName)) throw new TypeError("Invalid Firestore collection name");
      return makeCollection([collectionName]);
    },
  };
}
