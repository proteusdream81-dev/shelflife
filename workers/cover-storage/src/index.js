const MAX_BYTES = 5 * 1024 * 1024;
const READ_TTL_SECONDS = 7 * 24 * 60 * 60;
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwksCache;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, X-Book-Id",
    "access-control-max-age": "600",
    "vary": "Origin",
  } : {};
}

function b64urlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));
}

async function getJwks() {
  if (jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const response = await fetch(FIREBASE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error("Could not load Firebase signing keys");
  const body = await response.json();
  jwksCache = { keys: body.keys || [], expires: Date.now() + 50 * 60 * 1000 };
  return jwksCache.keys;
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function verifyFirebaseToken(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token");

  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token");
  if (claims.aud !== env.FIREBASE_PROJECT_ID) throw new Error("Invalid token audience");
  if (claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error("Invalid token issuer");
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
    claims.sub !== claims.user_id ||
    !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.auth_time) ||
    claims.exp <= now || claims.iat > now + 60 ||
    claims.auth_time > now + 60 || claims.auth_time > claims.iat
  ) {
    throw new Error("Expired or invalid token claims");
  }
  const jwk = (await getJwks()).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("Invalid token signature");
  await verifyFirebaseUser(token, claims, env);
  return claims;
}

async function verifyFirebaseUser(token, claims, env) {
  if (!env.FIREBASE_API_KEY) throw new Error("Firebase API key is not configured");
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!response.ok) throw new Error("Firebase account status lookup failed");
  const body = await response.json();
  const user = body.users?.find((candidate) => candidate.localId === claims.sub);
  if (!user || user.disabled === true) throw new Error("Firebase user is unavailable");
  const validSince = Number(user.validSince);
  if (!Number.isFinite(validSince) || claims.auth_time < validSince) {
    throw new Error("Firebase token has been revoked");
  }
}

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signReadKey(key, expires, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A signing secret of at least 32 characters is required");
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${key}\n${expires}`));
  return base64url(signature);
}

async function timingSafeStringEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }
  // Node.js test fallback: both values are fixed-size SHA-256 digests.
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function validReadSignature(key, expires, signature, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  if (Number(expires) > now + READ_TTL_SECONDS + 60) return false;
  const expected = await signReadKey(key, expires, secret);
  // Bound attacker-controlled query input before hashing while keeping both comparisons fixed-size.
  const supplied = typeof signature === "string" ? signature.slice(0, 128) : "";
  return timingSafeStringEqual(supplied, expected);
}

function isValidObjectKey(key) {
  if (typeof key !== "string" || key.length > 170 || key.includes("..") || key.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  const parts = key.split("/");
  if (parts.length !== 2) return false;
  const [ownerUid, filename] = parts;
  return ownerUid.length > 0 && ownerUid.length <= 128 &&
    /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(filename);
}

function decodeObjectKey(path, prefix) {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return null;
  }
}

function isValidBookId(bookId) {
  if (
    typeof bookId !== "string" ||
    bookId.length === 0 ||
    bookId.length > 1500 ||
    bookId === "." ||
    bookId === ".." ||
    bookId.includes("/")
  ) return false;
  for (let index = 0; index < bookId.length; index += 1) {
    const code = bookId.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

async function authorizeBookCover(bookId, idToken, env) {
  const endpoint = new URL(env.BOOK_AUTHORIZATION_URL || "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.origin !== "https://preview.shelflifetbr.com" ||
    endpoint.pathname !== "/api/covers/authorize" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Preview book authorization endpoint is not configured safely");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ bookId }),
  });

  if (response.status === 401 || response.status === 403 || response.status === 404) return false;
  if (!response.ok) throw new Error("Book authorization service is unavailable");
  const result = await response.json();
  return result?.authorized === true && result.bookId === bookId;
}

async function enforceMutationRateLimit(claims, env, cors) {
  if (!env.COVER_MUTATION_LIMITER) {
    throw new Error("Cover mutation rate limiter is not configured");
  }
  const result = await env.COVER_MUTATION_LIMITER.limit({ key: claims.sub });
  if (!result.success) {
    return json(
      { error: "Too many cover changes. Please wait before trying again." },
      429,
      { ...cors, "retry-after": "60" }
    );
  }
  return null;
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);
  const cors = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.headers.has("Origin") && !origin) return json({ error: "Origin not allowed" }, 403);

  if (request.method === "GET" && url.pathname.startsWith("/v1/covers/read/")) {
    const key = decodeObjectKey(url.pathname, "/v1/covers/read/");
    const expires = url.searchParams.get("expires") || "";
    const signature = url.searchParams.get("sig") || "";
    if (!key || !isValidObjectKey(key)) return json({ error: "Invalid object key" }, 400, cors);
    if (!await validReadSignature(key, expires, signature, env.SIGNING_SECRET)) return json({ error: "Invalid or expired link" }, 403, cors);
    const object = await env.COVERS.get(key);
    if (!object) return json({ error: "Cover not found" }, 404, cors);
    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=300");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-security-policy", "default-src 'none'; sandbox");
    return new Response(object.body, { headers });
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return json({ status: "ok", storage: "bound" }, 200, cors);
  }

  let claims;
  try {
    claims = await verifyFirebaseToken(request, env);
  } catch {
    return json({ error: "Authentication required" }, 401, cors);
  }

  const isUpload = url.pathname === "/v1/covers" && request.method === "PUT";
  const isDelete = url.pathname.startsWith("/v1/covers/") && request.method === "DELETE";
  if (isUpload || isDelete) {
    const rateLimitResponse = await enforceMutationRateLimit(claims, env, cors);
    if (rateLimitResponse) return rateLimitResponse;
  }

  if (isUpload) {
    const contentLengthHeader = request.headers.get("Content-Length");
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        return json({ error: "Invalid content length" }, 400, cors);
      }
      if (contentLength > MAX_BYTES) return json({ error: "Image exceeds 5 MiB limit" }, 413, cors);
    }
    const declaredType = (request.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(declaredType)) {
      return json({ error: "Only JPEG, PNG, and WebP images are accepted" }, 415, cors);
    }

    const bookId = request.headers.get("X-Book-Id") || "";
    if (!isValidBookId(bookId)) return json({ error: "A valid X-Book-Id is required" }, 400, cors);
    const idToken = getBearerToken(request);
    try {
      if (!await authorizeBookCover(bookId, idToken, env)) {
        return json({ error: "You are not authorized to change this book cover" }, 403, cors);
      }
    } catch {
      return json({ error: "Book authorization service is unavailable" }, 503, cors);
    }

    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Image body is required" }, 400, cors);
    // Use a fixed-size buffer so a hostile stream of tiny chunks cannot allocate a huge chunk array.
    const buffer = new Uint8Array(MAX_BYTES);
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > MAX_BYTES) {
        await reader.cancel();
        return json({ error: "Image exceeds 5 MiB limit" }, 413, cors);
      }
      buffer.set(value, totalBytes);
      totalBytes += value.byteLength;
    }
    if (!totalBytes) return json({ error: "Image body is required" }, 400, cors);
    const bytes = buffer.subarray(0, totalBytes);
    const actualType = imageType(bytes);
    if (!actualType || actualType !== declaredType) return json({ error: "Image content does not match its MIME type" }, 415, cors);
    const extension = actualType === "image/jpeg" ? "jpg" : actualType === "image/png" ? "png" : "webp";
    const key = `${claims.sub}/${crypto.randomUUID()}.${extension}`;
    await env.COVERS.put(key, bytes, {
      httpMetadata: { contentType: actualType, cacheControl: "private, max-age=300" },
      customMetadata: { ownerUid: claims.sub, bookId, uploadedAt: new Date().toISOString() },
    });
    const expires = String(Math.floor(Date.now() / 1000) + READ_TTL_SECONDS);
    const sig = await signReadKey(key, expires, env.SIGNING_SECRET);
    return json({ objectKey: key, bookId, contentType: actualType, size: bytes.byteLength,
      readUrl: `${url.origin}/v1/covers/read/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}` }, 201, cors);
  }

  if (isDelete) {
    const key = decodeObjectKey(url.pathname, "/v1/covers/");
    if (!key || !isValidObjectKey(key) || !key.startsWith(`${claims.sub}/`)) {
      return json({ error: "Forbidden" }, 403, cors);
    }
    await env.COVERS.delete(key);
    return new Response(null, { status: 204, headers: cors });
  }

  return json({ error: "Not found" }, 404, cors);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "cover storage request failed",
        error: error instanceof Error ? error.message : String(error),
        path: new URL(request.url).pathname,
      }));
      return json({ error: "Internal storage error" }, 500, corsHeaders(allowedOrigin(request, env)));
    }
  },
};
