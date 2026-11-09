#!/usr/bin/env node
/**
 * Provision one explicit Firebase UID -> Base44 user ID link.
 *
 * Run only from an authenticated operator shell with ADC access to the
 * ShelfLife Preview Firebase project. This script never links by email alone:
 * the operator must attest ownership, and Firebase Auth must independently
 * report the supplied UID's email as verified and equal to the supplied email.
 * Existing links are never overwritten.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "shelflife-tbr-9754d";

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (key === "--attest-account-ownership") {
      args.attest = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const { "firebase-uid": uid, email, "base44-user-id": base44UserId, "verified-by": verifiedBy } = args;

  if (!uid || !email || !base44UserId || !verifiedBy || args.attest !== true) {
    throw new Error(
      "Required: --firebase-uid, --email, --base44-user-id, --verified-by, and --attest-account-ownership",
    );
  }
  if (uid.length > 128 || base44UserId.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid UID, Base44 user ID, or email");
  }
  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`Refusing to run against unexpected project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  }

  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, "shelflife-identity-link-operator");
  const [firebaseUser] = await Promise.all([getAuth(app).getUser(uid)]);
  if (firebaseUser.disabled) throw new Error("Firebase account is disabled");
  if (firebaseUser.emailVerified !== true) throw new Error("Firebase account email is not verified");
  if ((firebaseUser.email || "").trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error("Firebase UID email does not match the operator-supplied email");
  }

  const db = getFirestore(app);
  const ref = db.collection("identityLinks").doc(uid);
  const existing = await ref.get();
  if (existing.exists) {
    const current = existing.data();
    if (current?.status === "verified" && current?.base44UserId === base44UserId) {
      process.stdout.write("Identity link already exists and matches; no write performed.\n");
      return;
    }
    throw new Error("An identity link already exists with different or unverified data; refusing to overwrite");
  }

  await ref.create({
    status: "verified",
    base44UserId,
    verifiedEmail: firebaseUser.email,
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedBy,
    verificationMethod: "operator-attested-firebase-auth-email",
  });
  process.stdout.write("Created the verified identity link. Proceed with the read-only Preview test.\n");
}

main().catch((error) => {
  process.stderr.write(`Identity link provisioning failed: ${error.message}\n`);
  process.exitCode = 1;
});
