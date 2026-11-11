// Resolve Firestore-native public links first while preserving the legacy Base44
// token resolver for links created before the migration.
export function normalizeFirebaseShare(payload) {
  if (!payload || typeof payload !== "object") throw new TypeError("Share service returned an invalid response");
  const reader = typeof payload.ownerName === "string" && payload.ownerName.trim()
    ? payload.ownerName.trim() : "A reader";
  const common = {
    ...payload,
    reader_name: reader,
    covers_hidden: payload.coversHidden === true,
  };
  if (payload.kind === "book") return { ...common, book: payload.item || {} };
  if (payload.kind === "shelf") return {
    ...common,
    shelf: payload.item || {},
    books: Array.isArray(payload.books) ? payload.books : [],
  };
  throw new TypeError("Share service returned an unsupported share type");
}

export async function loadSharePayload({
  token,
  firebaseEnabled = false,
  getFirebaseShare,
  getLegacyShare,
}) {
  if (firebaseEnabled && typeof getFirebaseShare === "function") {
    try {
      return normalizeFirebaseShare(await getFirebaseShare(token));
    } catch (error) {
      // A 404 means this is probably a pre-migration Base44 token. Do not hide
      // genuine Firebase outages or permission/configuration errors.
      if (error?.status !== 404) throw error;
    }
  }
  if (typeof getLegacyShare !== "function") throw new Error("Legacy share resolver is unavailable");
  const response = await getLegacyShare(token);
  return response?.data && typeof response.data === "object" ? response.data : {};
}
