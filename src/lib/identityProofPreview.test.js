import test from "node:test";
import assert from "node:assert/strict";
import { parseIdentityProofResult } from "./identityProofPreview.js";

const baseProof = {
  proofVerified: true,
  linked: false,
  writesDisabled: true,
  dryRun: true,
};

test("accepts a valid dual-session proof when identity IDs are withheld", () => {
  const result = parseIdentityProofResult(baseProof);
  assert.deepEqual(result, { ...baseProof, verifiedIdentity: null });
});

test("accepts valid dual-session proof when explicitly disclosed IDs are present", () => {
  const identity = {
    firebaseUid: "firebase-user",
    base44UserId: "legacy-user",
    proofMethod: "dual-session",
    verifiedAt: "2026-11-13T00:00:00.000Z",
  };
  assert.deepEqual(
    parseIdentityProofResult({ ...baseProof, verifiedIdentity: identity }),
    { ...baseProof, verifiedIdentity: identity },
  );
});

test("rejects incomplete or unsafe identity proof responses", () => {
  assert.equal(parseIdentityProofResult({ ...baseProof, linked: true }), null);
  assert.equal(parseIdentityProofResult({ ...baseProof, writesDisabled: false }), null);
  assert.equal(parseIdentityProofResult({ ...baseProof, verifiedIdentity: { firebaseUid: "only-one-id" } }), null);
});
