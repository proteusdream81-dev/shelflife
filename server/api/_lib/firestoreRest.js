const DATABASE_ID = "(default)";
const QUERYABLE_FIELDS = new Set(["created_by_id", "followerUid", "followingUid", "blockerUid", "blockedUid", "ownerUid", "isPrivate", "uid", "inviteeUid", "sharedWithUids", "shareEnabled", "shareAudience", "targetId", "shelfIds", "status"]);

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

function encodeValue(value) {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Firestore values must be finite numbers");
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new TypeError("Unsupported Firestore value");
}

function encodeFields(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) {
    throw new TypeError("Firestore document data must be a plain object");
  }
  return Object.fromEntries(Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, encodeValue(value)]));
}

function requireUpdateTime(value) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("A valid Firestore updateTime precondition is required");
  }
  return value;
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
    updateTime: document?.updateTime || null,
    data: () => decodeFields(document?.fields || {}),
  };
}

function snapshotFromQuery(result = []) {
  const docs = (Array.isArray(result) ? result : [])
    .filter((item) => item.document?.name)
    .map((item) => {
      const document = item.document;
      const path = document.name.split("/documents/")[1]?.split("/") || [];
      const id = path[path.length - 1] || "";
      const collectionId = path[path.length - 2] || "";
      const parentDocumentId = path[path.length - 3] || "";
      const parentCollectionId = path[path.length - 4] || "";
      const ref = {
        id,
        parent: {
          id: collectionId,
          parent: parentDocumentId ? { id: parentDocumentId, parent: parentCollectionId ? { id: parentCollectionId } : null } : null,
        },
      };
      return {
        id,
        ref,
        updateTime: document.updateTime || null,
        data: () => decodeFields(document.fields || {}),
      };
    });
  return { docs, size: docs.length, empty: docs.length === 0 };
}

export function createFirestoreRestClient({
  getAccessToken,
  fetchImpl = fetch,
  readOnly = false,
  projectId = "shelflife-tbr-9754d",
}) {
  if (!["shelflife-tbr-9754d", "shelflife-tbr-dev"].includes(projectId)) {
    throw new TypeError("An approved Firebase project ID is required");
  }
  const apiRoot = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents`;
  if (typeof readOnly !== "boolean") throw new TypeError("readOnly must be a boolean");
  const assertWritable = () => {
    if (readOnly) {
      const error = new Error("Firebase migration writes are disabled for this Firestore client");
      error.name = "FirestoreWritesDisabledError";
      error.code = "FIRESTORE_WRITES_DISABLED";
      throw error;
    }
  };
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

  function makeCollection(pathSegments, allDescendants = false) {
    const segments = [...pathSegments];
    const collectionName = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);
    const parentUrl = parentSegments.length
      ? `${apiRoot}/${encodePath(parentSegments)}`
      : apiRoot;

    function validateLimit(maximum) {
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 101) {
        throw new TypeError("Firestore query limit must be between 1 and 101");
      }
    }

    async function runQuery({ fieldFilter = null, maximum = 50, startAfterId = null } = {}) {
      validateLimit(maximum);

      const structuredQuery = {
        from: [{ collectionId: collectionName, ...(allDescendants ? { allDescendants: true } : {}) }],
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
              document = await request(`${apiRoot}/${encodePath(documentSegments)}`);
            } catch (error) {
              if (error?.code === "NOT_FOUND" || error?.code === 404) {
                return { exists: false, id: documentId, updateTime: null, data: () => null };
              }
              throw error;
            }
            return snapshotFromDocument(document, documentId);
          },
          async create(data) {
            assertWritable();
            const fields = encodeFields(data);
            const url = `${parentUrl}/${encodeURIComponent(collectionName)}?documentId=${encodeURIComponent(documentId)}`;
            const document = await request(url, {
              method: "POST",
              body: JSON.stringify({ fields }),
            });
            return snapshotFromDocument(document, documentId);
          },
          async update(data, { lastUpdateTime } = {}) {
            assertWritable();
            const fields = encodeFields(data);
            const fieldPaths = Object.keys(fields);
            if (fieldPaths.length === 0) throw new TypeError("At least one Firestore field update is required");
            const updateMask = fieldPaths.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
            const precondition = `currentDocument.updateTime=${encodeURIComponent(requireUpdateTime(lastUpdateTime))}`;
            const document = await request(`${apiRoot}/${encodePath(documentSegments)}?${updateMask}&${precondition}`, {
              method: "PATCH",
              body: JSON.stringify({ fields }),
            });
            return snapshotFromDocument(document, documentId);
          },
          async delete({ lastUpdateTime } = {}) {
            assertWritable();
            const precondition = `currentDocument.updateTime=${encodeURIComponent(requireUpdateTime(lastUpdateTime))}`;
            return request(`${apiRoot}/${encodePath(documentSegments)}?${precondition}`, { method: "DELETE" });
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
        const equalityValue = (typeof value === "string" && value.length <= 128) || typeof value === "boolean";
        const arrayContainsValue = operator === "array-contains" && typeof value === "string" && value.length <= 128;
        if (!QUERYABLE_FIELDS.has(field) || !((operator === "==" && equalityValue) || arrayContainsValue)) {
          throw new TypeError("Unsupported Firestore query");
        }
        return {
          limit(maximum) {
            validateLimit(maximum);
            const query = (startAfterId = null) => runQuery({
              fieldFilter: {
                field: { fieldPath: field },
                op: operator === "array-contains" ? "ARRAY_CONTAINS" : "EQUAL",
                value: encodeValue(value),
              },
              maximum,
              startAfterId,
            });
            return {
              get: () => query(),
              startAfter(documentId) {
                if (!validDocumentId(documentId)) throw new TypeError("Invalid Firestore cursor");
                return { get: () => query(documentId) };
              },
            };
          },
        };
      },
    };
  }

  async function commitWrites(writes) {
    assertWritable();
    if (!Array.isArray(writes) || writes.length < 1 || writes.length > 500) {
      throw new TypeError("A Firestore batch must contain between 1 and 500 writes");
    }
    const normalized = writes.map((write) => {
      const parts = typeof write?.path === "string" ? write.path.split("/") : [];
      if (parts.length < 2 || parts.length % 2 !== 0 ||
          parts.some((part, index) => index % 2 === 0 ? !validCollectionName(part) : !validDocumentId(part))) {
        throw new TypeError("Invalid Firestore document path");
      }
      const name = `${apiRoot}/${encodePath(parts)}`;
      if (write.type === "create") {
        return {
          update: { name, fields: encodeFields(write.data) },
          currentDocument: { exists: false },
        };
      }
      if (write.type === "update") {
        const fields = encodeFields(write.data);
        const fieldPaths = Object.keys(fields);
        if (fieldPaths.length === 0) throw new TypeError("At least one Firestore field update is required");
        return {
          update: { name, fields, updateMask: { fieldPaths } },
          currentDocument: { updateTime: requireUpdateTime(write.updateTime) },
        };
      }
      if (write.type === "delete") {
        return { delete: name, currentDocument: { updateTime: requireUpdateTime(write.updateTime) } };
      }
      throw new TypeError("Unsupported Firestore batch write type");
    });
    return request(`${apiRoot}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes: normalized }),
    });
  }

  async function createIdentityLinkPair({ firebaseUid, base44UserId, verifiedAt }) {
    assertWritable();
    if (!validDocumentId(firebaseUid) || firebaseUid.length > 128 ||
        !validDocumentId(base44UserId) || base44UserId.length > 128) {
      throw new TypeError("Valid Firebase and Base44 identity IDs are required");
    }
    if (typeof verifiedAt !== "string" || !Number.isFinite(Date.parse(verifiedAt))) {
      throw new TypeError("A valid identity verification timestamp is required");
    }

    const common = {
      status: "verified",
      proofMethod: "dual-session",
      verifiedAt,
      verifiedBy: firebaseUid,
    };
    const writes = [
      {
        update: {
          name: `${apiRoot}/identityLinks/${firebaseUid}`,
          fields: encodeFields({ ...common, base44UserId }),
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${apiRoot}/legacyIdentityLinks/${base44UserId}`,
          fields: encodeFields({ ...common, firebaseUid }),
        },
        currentDocument: { exists: false },
      },
    ];
    return request(`${apiRoot}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
  }

  const client = {
    // Expose the project binding so migration tooling can verify the actual target.
    collection(collectionName) {
      if (!validCollectionName(collectionName)) throw new TypeError("Invalid Firestore collection name");
      return makeCollection([collectionName]);
    },
    collectionGroup(collectionName) {
      if (!validCollectionName(collectionName)) throw new TypeError("Invalid Firestore collection group name");
      return makeCollection([collectionName], true);
    },
    createIdentityLinkPair,
    commitWrites,
  };
  Object.defineProperty(client, "readOnly", {
    value: readOnly,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(client, "projectId", {
    value: projectId,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return client;
}
