const PROJECT_ID = "shelflife-tbr-9754d";
const DATABASE_ID = "(default)";
const API_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

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

export function createFirestoreRestClient({ getAccessToken, fetchImpl = fetch }) {
  if (typeof getAccessToken !== "function") throw new TypeError("A Google access-token provider is required");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

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

  return {
    collection(collectionName) {
      if (typeof collectionName !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(collectionName)) {
        throw new TypeError("Invalid Firestore collection name");
      }
      return {
        doc(documentId) {
          if (typeof documentId !== "string" || !documentId || documentId.includes("/")) {
            throw new TypeError("Invalid Firestore document ID");
          }
          return {
            async get() {
              const document = await request(`${API_ROOT}/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}`);
              return {
                exists: Boolean(document.name),
                id: document.name?.split("/").pop() || documentId,
                data: () => decodeFields(document.fields || {}),
              };
            },
          };
        },
        where(field, operator, value) {
          if (field !== "created_by_id" || operator !== "==" || typeof value !== "string") {
            throw new TypeError("Unsupported Firestore query");
          }
          return {
            limit(maximum) {
              if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) {
                throw new TypeError("Invalid Firestore query limit");
              }
              return {
                async get() {
                  const result = await request(`${API_ROOT}:runQuery`, {
                    method: "POST",
                    body: JSON.stringify({
                      structuredQuery: {
                        from: [{ collectionId: collectionName }],
                        where: {
                          fieldFilter: {
                            field: { fieldPath: field },
                            op: "EQUAL",
                            value: encodeString(value),
                          },
                        },
                        limit: maximum,
                      },
                    }),
                  });
                  const docs = (Array.isArray(result) ? result : [])
                    .filter((item) => item.document?.name)
                    .map((item) => {
                      const document = item.document;
                      return {
                        id: document.name.split("/").pop(),
                        data: () => decodeFields(document.fields || {}),
                      };
                    });
                  return { docs };
                },
              };
            },
          };
        },
      };
    },
  };
}
