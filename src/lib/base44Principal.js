const ID_PATTERN = /^[^/\\u0000-\\u001f\\u007f]{1,128}$/;

export async function deriveBase44FirestoreUid(base44UserId) {
  if (typeof base44UserId !== "string" || !ID_PATTERN.test(base44UserId) ||
      base44UserId === "." || base44UserId === "..") {
    throw new TypeError("A valid Base44 user ID is required");
  }
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
    throw new Error("Secure browser hashing is unavailable");
  }
  const input = new TextEncoder().encode(`shelflife-base44-v1:${base44UserId}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `b44_${hex}`;
}
