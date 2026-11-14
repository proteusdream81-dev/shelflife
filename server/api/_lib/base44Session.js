import { createClient } from "@base44/sdk";

export class InvalidBase44SessionError extends Error {
  constructor() {
    super("Legacy Base44 session is invalid");
    this.name = "InvalidBase44SessionError";
  }
}

export function createBase44SessionVerifier({
  createClientImpl = createClient,
  getAppId = () => process.env.BASE44_APP_ID,
} = {}) {
  return async function verifyBase44Session(token) {
    if (typeof token !== "string" || !token || token.length > 10000 || /\s/.test(token)) {
      throw new InvalidBase44SessionError();
    }
    const appId = getAppId();
    if (typeof appId !== "string" || !/^[a-f0-9]{20,64}$/i.test(appId)) {
      throw new Error("Base44 server app ID is not configured");
    }

    const client = createClientImpl({
      appId,
      token,
      serverUrl: "https://base44.app",
    });
    let user;
    try {
      user = await client.auth.me();
    } catch {
      throw new InvalidBase44SessionError();
    }
    if (!user || typeof user.id !== "string" || !user.id.trim() ||
        user.id.length > 128 || user.id === "." || user.id === ".." ||
        user.id.includes("/") || /[\x00-\x1f\x7f]/.test(user.id)) {
      throw new InvalidBase44SessionError();
    }
    return { id: user.id };
  };
}

export const verifyBase44Session = createBase44SessionVerifier();
