import { verifyFirebaseBearerToken, getFirebaseAdminFirestore } from "./firebaseAuth.js";
import {
  createUserLibraryRecord,
  updateUserLibraryRecord,
  InvalidLibraryInputError,
  LibraryRecordNotFoundError,
  LibraryWriteConflictError,
} from "./firestoreLibraryWrites.js";

export function createLibraryWriteHandler({
  collection,
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  createRecord = createUserLibraryRecord,
  updateRecord = updateUserLibraryRecord,
} = {}) {
  if (!["books", "shelves"].includes(collection)) throw new TypeError("Unsupported library collection");
  if (!["create", "update"].includes(operation)) throw new TypeError("Unsupported library write operation");

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const expectedMethod = operation === "create" ? "POST" : "PATCH";
    if (req.method !== expectedMethod) {
      res.setHeader("Allow", expectedMethod);
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified email required" });
    }

    const id = req.query?.id;
    if (operation === "update" && (typeof id !== "string" || !id)) {
      return res.status(400).json({ error: "A record ID is required" });
    }

    try {
      const db = await getDb();
      const record = operation === "create"
        ? await createRecord({ db, uid: auth.user.uid, collection, data: req.body })
        : await updateRecord({ db, uid: auth.user.uid, collection, id, data: req.body });
      return res.status(operation === "create" ? 201 : 200).json({ record });
    } catch (error) {
      if (error instanceof InvalidLibraryInputError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof LibraryRecordNotFoundError) {
        return res.status(404).json({ error: "Library record not found" });
      }
      if (error instanceof LibraryWriteConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error("[firebase-library] write failed", {
        collection,
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Library data service unavailable" });
    }
  };
}
