import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { requireUser, unauthorized } from "../../shared/requireUser.ts";

const APP_ID = "6ac5feeacf2ab847112ee3ed";
const CODE_TTL_SECONDS = 300;
const ALLOWED_ORIGINS = new Set([
  "https://shelf-life-112ee3ed.base44.app",
  "https://shelflifetbr.com",
]);

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function issueBridgeCode(base44UserId: string) {
  const privateKeyValue = Deno.env.get("SHELFLIFE_IDENTITY_BRIDGE_PRIVATE_KEY_B64");
  if (!privateKeyValue) throw new Error("Identity bridge signing key is not configured");

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyValue),
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "base44:" + APP_ID,
    aud: "shelflife-firebase-preview",
    purpose: "shelflife-migration-identity-proof",
    sub: base44UserId,
    jti: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    iat: issuedAt,
    exp: issuedAt + CODE_TTL_SECONDS,
  };
  const header = encodeJson({ alg: "EdDSA", typ: "JWT" });
  const body = encodeJson(payload);
  const signingInput = header + "." + body;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return {
    bridgeCode: signingInput + "." + toBase64Url(new Uint8Array(signature)),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export default async function(req: Request) {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Origin not allowed" }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
    return json({ error: "This endpoint accepts no caller-supplied identity data" }, 400);
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();
    if (
      typeof user.id !== "string" ||
      !user.id ||
      user.id.length > 128 ||
      user.id.includes("/")
    ) {
      return json({ error: "Existing ShelfLife session could not be verified" }, 401);
    }

    const issued = await issueBridgeCode(user.id);
    return json(issued, 200);
  } catch {
    return json({ error: "Could not issue the secure one-time verification code" }, 503);
  }
}