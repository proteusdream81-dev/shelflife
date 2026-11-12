export function parseIdentityProofResult(payload) {
  if (
    payload?.proofVerified !== true ||
    payload?.linked !== false ||
    payload?.writesDisabled !== true ||
    payload?.dryRun !== true
  ) {
    return null;
  }

  // Identity IDs are intentionally withheld unless a separate Preview-only
  // disclosure flag is enabled. Their absence must not invalidate the proof.
  if (payload.verifiedIdentity === undefined || payload.verifiedIdentity === null) {
    return { ...payload, verifiedIdentity: null };
  }

  const identity = payload.verifiedIdentity;
  if (
    typeof identity !== "object" ||
    identity.proofMethod !== "dual-session" ||
    typeof identity.firebaseUid !== "string" ||
    !identity.firebaseUid ||
    typeof identity.base44UserId !== "string" ||
    !identity.base44UserId
  ) {
    return null;
  }

  return payload;
}
