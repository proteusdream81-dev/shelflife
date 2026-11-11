import { randomUUID } from "node:crypto";
import { verifyFirebaseBearerToken, getFirebaseAdminFirestoreSmokeTest } from "../_lib/firebaseAuth.js";

export function createWifSmokeTestHandler({
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestoreSmokeTest,
  createId = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
      return res.status(400).json({ error: "This diagnostic accepts no caller-supplied data" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) {
      return res.status(403).json({ error: "Verified Firebase email required" });
    }

    let db;
    let ref;
    let created = false;
    try {
      db = await getDb();
      if (db.projectId !== "shelflife-tbr-dev" || db.readOnly !== false) {
        throw new Error("The WIF diagnostic did not receive the isolated writable development client");
      }
      const documentId = `smoke_${String(createId()).replace(/-/g, "")}`;
      ref = db.collection("migrationSmokeTests").doc(documentId);
      const payload = {
        purpose: "wif-auth-smoke-test",
        projectId: "shelflife-tbr-dev",
        firebaseUid: auth.user.uid,
        createdAt: now(),
      };
      await ref.create(payload);
      created = true;
      const snapshot = await ref.get();
      const actual = snapshot.data();
      if (!snapshot.exists || !snapshot.updateTime ||
          actual?.purpose !== payload.purpose ||
          actual?.projectId !== payload.projectId ||
          actual?.firebaseUid !== payload.firebaseUid ||
          actual?.createdAt !== payload.createdAt) {
        throw new Error("Firestore WIF smoke-test read-back did not match the created document");
      }
      await ref.delete({ lastUpdateTime: snapshot.updateTime });
      created = false;
      const deletedSnapshot = await ref.get();
      if (deletedSnapshot.exists) throw new Error("Firestore WIF smoke-test document remained after cleanup");
      return res.status(200).json({
        ok: true,
        projectId: "shelflife-tbr-dev",
        operation: "create-read-delete",
        readBackVerified: true,
        cleanupVerified: true,
      });
    } catch (error) {
      if (created && ref) {
        try {
          const snapshot = await ref.get();
          if (snapshot.exists && snapshot.updateTime) {
            await ref.delete({ lastUpdateTime: snapshot.updateTime });
          }
        } catch (cleanupError) {
          console.error("[wif-smoke-test] cleanup failed", {
            name: typeof cleanupError?.name === "string" ? cleanupError.name.slice(0, 80) : "Error",
            code: typeof cleanupError?.code === "string" || typeof cleanupError?.code === "number" ? String(cleanupError.code).slice(0, 80) : null,
          });
        }
      }
      console.error("[wif-smoke-test] diagnostic failed", {
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Development Firebase workload identity smoke test failed" });
    }
  };
}

export default createWifSmokeTestHandler();
