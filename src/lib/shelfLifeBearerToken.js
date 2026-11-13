/**
 * Select the bearer credential for the migration Preview API adapters.
 * Firebase remains preferred; the legacy Base44 session is a Preview-only fallback.
 */
export function createShelfLifeBearerTokenProvider({
  getFirebaseToken,
  getBase44Token,
  isCompatibilityEnabled = () => false,
} = {}) {
  if (typeof getFirebaseToken !== "function" ||
      typeof getBase44Token !== "function" ||
      typeof isCompatibilityEnabled !== "function") {
    throw new TypeError("Bearer token providers and compatibility gate are required");
  }

  return async function getShelfLifeBearerToken(forceRefresh = false) {
    const firebaseToken = await getFirebaseToken(forceRefresh);
    if (typeof firebaseToken === "string" && firebaseToken) return firebaseToken;

    if (!isCompatibilityEnabled()) {
      throw new Error("You must be signed in.");
    }

    const base44Token = await getBase44Token();
    if (typeof base44Token !== "string" || !base44Token || /\s/.test(base44Token)) {
      throw new Error("You must be signed in.");
    }
    return base44Token;
  };
}
