
import { createHash } from "node:crypto";
import { getFirebaseAdminFirestoreRateLimits } from "./firebaseAuth.js";

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export class FirebaseRateLimitStoreError extends Error {
  constructor(message = "Rate-limit storage is unavailable") {
    super(message);
    this.name = "FirebaseRateLimitStoreError";
  }
}

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

function isWriteConflict(error) {
  return [409, "ALREADY_EXISTS", "FAILED_PRECONDITION", "ABORTED"].includes(error?.code);
}

/**
 * A Firestore compare-and-set sliding-window limiter. Only hashed actor identifiers
 * are persisted; the document stores at most `max` timestamps for one bucket.
 * The supplied Firestore client must allow writes only to the top-level rateLimits
 * collection. Contention retries are bounded and exhaustion fails closed.
 *
 * @param {{ getDb?: () => Promise<any>, now?: () => number, maxAttempts?: number }} [options]
 */
export function createFirebaseRateLimiter({
  getDb = getFirebaseAdminFirestoreRateLimits,
  now = () => Date.now(),
  maxAttempts = 8,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("Rate-limit retry count must be between 1 and 20");
  }

  async function consume({ uid, bucket, max, windowMs = RATE_LIMIT_WINDOW_MS }) {
    if (typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/")) {
      throw new TypeError("A valid Firebase UID is required for rate limiting");
    }
    if (typeof bucket !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(bucket)) {
      throw new TypeError("A valid rate-limit bucket is required");
    }
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      throw new TypeError("Rate limit must be an integer from 1 to 1000");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 24 * RATE_LIMIT_WINDOW_MS) {
      throw new TypeError("Rate-limit window must be between one second and 24 hours");
    }

    const db = await getDb();
    if (!db || typeof db.collection !== "function") throw new FirebaseRateLimitStoreError();
    const actorHash = hash(uid);
    const documentId = hash(`${bucket}\0${uid}`);
    const ref = db.collection("rateLimits").doc(documentId);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const nowMs = now();
      if (!Number.isFinite(nowMs)) throw new TypeError("Rate-limit clock returned an invalid time");
      const snapshot = await ref.get();
      const existing = snapshot.exists ? snapshot.data() : null;
      const cutoff = nowMs - windowMs;
      const recent = (Array.isArray(existing?.timestamps) ? existing.timestamps : [])
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff)
        .sort((a, b) => a - b)
        .slice(-max);

      if (recent.length >= max) return false;

      recent.push(nowMs);
      const payload = {
        bucket,
        actorHash,
        timestamps: recent,
        updatedAt: new Date(nowMs).toISOString(),
        schemaVersion: 1,
      };

      try {
        if (snapshot.exists) {
          await ref.update(payload, { lastUpdateTime: snapshot.updateTime });
        } else {
          await ref.create(payload);
        }
        return true;
      } catch (error) {
        if (isWriteConflict(error)) continue;
        throw new FirebaseRateLimitStoreError();
      }
    }

    throw new FirebaseRateLimitStoreError("Rate-limit update contention exceeded the retry budget");
  }

  return Object.freeze({ consume });
}

export const firebaseRateLimiter = createFirebaseRateLimiter();
export const consumeFirebaseRateLimit = (options) => firebaseRateLimiter.consume(options);
