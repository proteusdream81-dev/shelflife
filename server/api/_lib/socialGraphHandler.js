
import { verifyFirebaseBearerToken, getFirebaseAdminFirestore, findFirebaseUserByEmail } from "./firebaseAuth.js";
import { consumeFirebaseRateLimit } from "./rateLimit.js";
import { resolveShelfLifeProfile, IdentityNotLinkedError, ProfileNotMigratedError } from "./profile.js";
import {
  acceptFollowRequest, blockReader, checkUsernameAvailability, createFollowRequest, getReadingCircleOverview, listUserRelationships, removeFollowRelationship, searchReader, unblockReader,
  SocialGraphInputError, SocialGraphNotFoundError, SocialGraphPermissionError, SocialGraphConflictError,
} from "./socialGraph.js";

const OPERATIONS = new Set(["follow", "accept", "remove", "block", "unblock", "list", "search", "overview"]);

export function createSocialGraphHandler({
  operation,
  verifyToken = verifyFirebaseBearerToken,
  getDb = getFirebaseAdminFirestore,
  resolveProfile = resolveShelfLifeProfile,
  consumeLimit = consumeFirebaseRateLimit,
  findUserByEmail = findFirebaseUserByEmail,
  searchReaders = searchReader,
  checkUsername = checkUsernameAvailability,
  getOverview = getReadingCircleOverview,
} = {}) {
  if (!OPERATIONS.has(operation)) throw new TypeError("Unsupported social graph operation");

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    const method = ["list", "search", "overview"].includes(operation) ? "GET"
      : ["follow", "block"].includes(operation) ? "POST"
        : operation === "accept" ? "PATCH" : "DELETE";
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ error: "Method not allowed" });
    }

    const auth = await verifyToken(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (auth.user.emailVerified !== true) return res.status(403).json({ error: "Verified email required" });

    const target = operation === "follow" ? req.body?.followingUid
      : operation === "block" ? req.body?.blockedUid
        : operation === "unblock" ? req.query?.uid
          : operation === "list" ? req.query?.direction || "following"
          : ["search", "overview"].includes(operation) ? null : req.query?.id;
    if (!["list", "search", "overview"].includes(operation) && (typeof target !== "string" || !target)) return res.status(400).json({ error: "A target ID is required" });
    if (operation === "follow" && Object.keys(req.body || {}).length !== 1) {
      return res.status(400).json({ error: "Only followingUid is accepted" });
    }
    if (operation === "block" && Object.keys(req.body || {}).length !== 1) {
      return res.status(400).json({ error: "Only blockedUid is accepted" });
    }

    const searchEmail = operation === "search" && typeof req.query?.email === "string"
      ? req.query.email.trim().toLowerCase() : "";
    const searchUsername = operation === "search" && typeof req.query?.username === "string"
      ? req.query.username.trim().replace(/^@+/, "").toLowerCase() : "";
    const usernameAvailabilityQuery = operation === "search" && typeof req.query?.checkUsername === "string"
      ? req.query.checkUsername.trim().replace(/^@+/, "").toLowerCase() : "";
    const searchName = operation === "search" && typeof req.query?.name === "string"
      ? req.query.name.trim().replace(/\s+/g, " ") : "";
    if (operation === "search") {
      const modes = [searchEmail, searchUsername, usernameAvailabilityQuery, searchName].filter(Boolean).length;
      if (modes !== 1) {
        return res.status(400).json({ error: "Provide an exact email, exact username, username availability check, or name search" });
      }
      if (searchEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchEmail)) {
        return res.status(400).json({ error: "A valid exact email address is required" });
      }
      if (searchUsername && !/^[a-z0-9_]{3,20}$/.test(searchUsername)) {
        return res.status(400).json({ error: "A username is 3-20 letters, numbers or underscores" });
      }
      if (usernameAvailabilityQuery && !/^[a-z0-9_]{3,20}$/.test(usernameAvailabilityQuery)) {
        return res.status(400).json({ error: "A username is 3-20 letters, numbers or underscores" });
      }
      if (searchName && (searchName.length < 2 || searchName.length > 40)) {
        return res.status(400).json({ error: "A reader name search must be 2-40 characters" });
      }
    }

    try {
      const db = await getDb();
      await resolveProfile({ db, firebaseUser: auth.user });
      if (operation === "overview") {
        const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleRead", max: 150 });
        if (!allowed) return res.status(429).json({ error: "Too many Reading Circle lookups in one hour. Please try again later." });
        const result = await getOverview({ db, uid: auth.user.uid });
        return res.status(200).json(result);
      }
      if (operation === "search") {
        if (usernameAvailabilityQuery) {
          const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleWrite", max: 60 });
          if (!allowed) return res.status(429).json({ error: "Too many username checks in one hour. Please try again later." });
          const result = await checkUsername({ db, viewerUid: auth.user.uid, username: usernameAvailabilityQuery });
          return res.status(200).json(result);
        }
        if (searchName) {
          const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleNameSearch", max: 60 });
          if (!allowed) return res.status(429).json({ error: "Too many reader searches in a row — please try again later." });
          const result = await searchReaders({ db, viewerUid: auth.user.uid, nameQuery: searchName });
          return res.status(200).json(result);
        }
        const emailLookup = Boolean(searchEmail);
        const allowed = await consumeLimit({
          uid: auth.user.uid,
          bucket: emailLookup ? "readingCircleEmailLookup" : "readingCircleNameSearch",
          max: emailLookup ? 15 : 60,
        });
        if (!allowed) return res.status(429).json({ error: "Too many reader searches in a row — please try again later." });
        const emailUser = emailLookup ? await findUserByEmail(searchEmail) : null;
        const result = await searchReaders({
          db, viewerUid: auth.user.uid, username: searchUsername || null,
          emailLookup, emailUser, emailFallback: searchEmail,
        });
        return res.status(200).json(result);
      }
      if (["follow", "accept", "remove", "block", "unblock"].includes(operation)) {
        const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleWrite", max: 60 });
        if (!allowed) return res.status(429).json({ error: "Too many connection changes in one hour. Please try again later." });
      }
      let result;
      if (operation === "list") {
        const limitValue = req.query?.limit === undefined ? 50 : Number(req.query.limit);
        if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
          return res.status(400).json({ error: "Page size must be between 1 and 100" });
        }
        const allowed = await consumeLimit({ uid: auth.user.uid, bucket: "readingCircleRead", max: 150 });
        if (!allowed) return res.status(429).json({ error: "Too many Reading Circle lookups in one hour. Please try again later." });
        const cursor = req.query?.cursor || null;
        result = await listUserRelationships({ db, uid: auth.user.uid, direction: target, limit: limitValue, cursor });
      } else if (operation === "follow") {
        result = await createFollowRequest({ db, followerUid: auth.user.uid, followingUid: target });
      } else if (operation === "accept") {
        result = await acceptFollowRequest({ db, relationshipId: target, actorUid: auth.user.uid });
      } else if (operation === "remove") {
        result = await removeFollowRelationship({ db, relationshipId: target, actorUid: auth.user.uid });
      } else if (operation === "block") {
        result = await blockReader({ db, blockerUid: auth.user.uid, blockedUid: target });
      } else {
        result = await unblockReader({ db, blockerUid: auth.user.uid, blockedUid: target });
      }
      return res.status(operation === "follow" || operation === "block" ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof IdentityNotLinkedError || error instanceof ProfileNotMigratedError) {
        return res.status(409).json({ error: "Account migration is not complete" });
      }
      if (error instanceof SocialGraphInputError) return res.status(400).json({ error: error.message });
      if (error instanceof SocialGraphNotFoundError) return res.status(404).json({ error: "Reader or relationship not found" });
      if (error instanceof SocialGraphPermissionError) return res.status(403).json({ error: error.message });
      if (error instanceof SocialGraphConflictError) return res.status(409).json({ error: error.message });
      console.error("[firebase-social-graph] request failed", {
        operation,
        name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code).slice(0, 80) : null,
      });
      return res.status(503).json({ error: "Social graph service unavailable" });
    }
  };
}
