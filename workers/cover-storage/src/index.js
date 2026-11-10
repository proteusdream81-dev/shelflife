const MAX_COVER_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

class CoverInputError extends Error {}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins(env).includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Book-Id, X-Object-Key",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

export function validCoverObjectKey(key, uid) {
  if (typeof key !== "string" || key.length > 180 || key.includes("..") || key.includes("\\")) return false;
  const parts = key.split("/");
  const filename = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
  return parts.length === 2 && parts[0] === uid && filename.test(parts[1]);
}

async function fetchFirebaseJwks(fetchImpl) {
  const response = await fetchImpl(FIREBASE_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Firebase signing keys unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error("Firebase signing keys invalid");
  return payload.keys;
}

export async function verifyFirebaseIdToken(token, env, { fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  let claims;
  let signature;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
    signature = base64UrlToBytes(parts[2]);
  } catch {
    return null;
  }

  if (header?.alg !== "RS256" || typeof header.kid !== "string" ||
      claims?.aud !== env.FIREBASE_PROJECT_ID ||
      claims?.iss !== "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID ||
      !validUid(claims?.sub) || claims?.email_verified !== true) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 300 ||
      !Number.isFinite(claims.auth_time) || claims.auth_time > now + 300) {
    return null;
  }

  try {
    const jwks = await fetchFirebaseJwks(fetchImpl);
    const jwk = jwks.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
    return valid ? claims : null;
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function readBoundedBody(request, maximum) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maximum) throw new RangeError("Cover image exceeds 5 MiB");
  if (!request.body) throw new CoverInputError("Cover image body is required");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new RangeError("Cover image exceeds 5 MiB");
    }
    chunks.push(result.value);
  }
  if (total < 1) throw new CoverInputError("Cover image body is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function detectImage(bytes, contentType) {
  if (contentType === "image/jpeg" &&
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (contentType === "image/png" &&
      bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (contentType === "image/webp" &&
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

async function authorizeBook({ env, fetchImpl, token, bookId, objectKey }) {
  let endpoint;
  try { endpoint = new URL(env.AUTHORIZATION_API_URL); }
  catch { throw new Error("Cover authorization endpoint is not configured"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.pathname !== "/api/covers/authorize" || endpoint.search || endpoint.hash) {
    throw new Error("Cover authorization endpoint must use HTTPS");
  }
  const body = objectKey ? { bookId, objectKey } : { bookId };
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status >= 500) throw new Error("Cover authorization service failed");
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  return result?.authorized === true && result.bookId === bookId;
}

async function importSigningKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Cover URL signing secret is not configured");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signReadUrl(secret, key, expiry) {
  const signingKey = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(key + "\n" + expiry),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyReadUrl(secret, key, expiry, signature) {
  const signingKey = await importSigningKey(secret);
  try {
    return await crypto.subtle.verify(
      "HMAC",
      signingKey,
      base64UrlToBytes(signature),
      new TextEncoder().encode(key + "\n" + expiry),
    );
  } catch {
    return false;
  }
}

function decodeKeyFromPath(pathname, prefix) {
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try { return decodeURIComponent(encoded); } catch { return null; }
}

export function createCoverWorker({
  verifyToken = verifyFirebaseIdToken,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  return {
    async fetch(request, env) {
      const cors = corsHeaders(request, env);
      if (cors === null) return json({ error: "Origin not allowed" }, 403);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors || {} });
      }

      const url = new URL(request.url);
      try {
        if (url.pathname.startsWith("/v1/covers/read/") && request.method === "GET") {
          const key = decodeKeyFromPath(url.pathname, "/v1/covers/read/");
          const expiry = Number(url.searchParams.get("exp"));
          const signature = url.searchParams.get("sig") || "";
          const nowSeconds = Math.floor(now() / 1000);
          if (!key || !Number.isInteger(expiry) || expiry <= nowSeconds ||
              expiry > nowSeconds + SIGNED_URL_TTL_SECONDS + 60 ||
              !await verifyReadUrl(env.COVER_URL_SIGNING_SECRET, key, expiry, signature)) {
            return json({ error: "Signed cover URL is invalid or expired" }, 403, cors || {});
          }
          const object = await env.COVER_BUCKET.get(key);
          if (!object) return json({ error: "Cover not found" }, 404, cors || {});
          const contentType = object.httpMetadata?.contentType || "application/octet-stream";
          if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
            return json({ error: "Unsupported cover object" }, 415, cors || {});
          }
          return new Response(object.body, {
            status: 200,
            headers: {
              ...cors,
              "Content-Type": contentType,
              "Cache-Control": "private, max-age=60",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
        }

        if (url.pathname === "/v1/covers" && request.method === "PUT") {
          const token = bearerToken(request);
          if (!token) return json({ error: "Unauthorized" }, 401, cors || {});
          const claims = await verifyToken(token, env, { fetchImpl });
          if (!claims) return json({ error: "Unauthorized" }, 401, cors || {});
          const bookId = request.headers.get("X-Book-Id");
          if (typeof bookId !== "string" || !bookId || bookId.includes("/")) {
            return json({ error: "A valid book ID is required" }, 400, cors || {});
          }
          if (!await authorizeBook({ env, fetchImpl, token, bookId })) {
            return json({ error: "Book access denied" }, 403, cors || {});
          }
          const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
          if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
            return json({ error: "Only JPEG, PNG and WebP images are accepted" }, 415, cors || {});
          }
          const bytes = await readBoundedBody(request, MAX_COVER_BYTES);
          const extension = detectImage(bytes, contentType);
          if (!extension) return json({ error: "Image content does not match its media type" }, 415, cors || {});
          const objectKey = claims.sub + "/" + crypto.randomUUID() + "." + extension;
          const expiry = Math.floor(now() / 1000) + SIGNED_URL_TTL_SECONDS;
          const signature = await signReadUrl(env.COVER_URL_SIGNING_SECRET, objectKey, expiry);
          await env.COVER_BUCKET.put(objectKey, bytes, {
            httpMetadata: { contentType },
            customMetadata: { ownerUid: claims.sub, bookId },
          });
          const readUrl = new URL("/v1/covers/read/" + encodeURIComponent(objectKey), url.origin);
          readUrl.searchParams.set("exp", String(expiry));
          readUrl.searchParams.set("sig", signature);
          return json({ bookId, objectKey, readUrl: readUrl.toString(), expiresAt: expiry }, 201, cors || {});
        }

        if (url.pathname === "/v1/covers/read-url" && request.method === "POST") {
          const token = bearerToken(request);
          if (!token) return json({ error: "Unauthorized" }, 401, cors || {});
          const claims = await verifyToken(token, env, { fetchImpl });
          if (!claims) return json({ error: "Unauthorized" }, 401, cors || {});
          const bookId = request.headers.get("X-Book-Id");
          const objectKey = request.headers.get("X-Object-Key");
          if (typeof bookId !== "string" || !bookId || bookId.includes("/") ||
              !validCoverObjectKey(objectKey, claims.sub)) {
            return json({ error: "A valid book and cover key are required" }, 400, cors || {});
          }
          if (!await authorizeBook({ env, fetchImpl, token, bookId, objectKey })) {
            return json({ error: "Book access denied" }, 403, cors || {});
          }
          const object = await env.COVER_BUCKET.head(objectKey);
          if (!object) return json({ error: "Cover not found" }, 404, cors || {});
          const expiry = Math.floor(now() / 1000) + SIGNED_URL_TTL_SECONDS;
          const signature = await signReadUrl(env.COVER_URL_SIGNING_SECRET, objectKey, expiry);
          const readUrl = new URL("/v1/covers/read/" + encodeURIComponent(objectKey), url.origin);
          readUrl.searchParams.set("exp", String(expiry));
          readUrl.searchParams.set("sig", signature);
          return json({ bookId, readUrl: readUrl.toString(), expiresAt: expiry }, 200, cors || {});
        }

        if (url.pathname.startsWith("/v1/covers/") && request.method === "DELETE") {
          const token = bearerToken(request);
          if (!token) return json({ error: "Unauthorized" }, 401, cors || {});
          const claims = await verifyToken(token, env, { fetchImpl });
          if (!claims) return json({ error: "Unauthorized" }, 401, cors || {});
          const key = decodeKeyFromPath(url.pathname, "/v1/covers/");
          if (!validCoverObjectKey(key, claims.sub)) return json({ error: "Cover access denied" }, 403, cors || {});
          await env.COVER_BUCKET.delete(key);
          return new Response(null, { status: 204, headers: cors || {} });
        }

        return json({ error: "Not found" }, 404, cors || {});
      } catch (error) {
        const status = error instanceof RangeError ? 413 :
          error instanceof CoverInputError ? 400 : 503;
        console.error(JSON.stringify({
          message: "cover request failed",
          path: url.pathname,
          status,
          error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        }));
        return json({ error: status === 413 ? "Cover image exceeds 5 MiB" : "Cover service unavailable" }, status, cors || {});
      }
    },
  };
}

export default createCoverWorker();
