#!/usr/bin/env node
/**
 * Offline integrity and key-recovery drill for a local ShelfLife backup bundle.
 * Decrypts into memory only; never writes plaintext records to disk.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { decryptBuffer } from "./base44DirectExport.js";

function required(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return process.env[name];
}
function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function safeBundlePath(root, rel) {
  if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) {
    throw new Error(`Unsafe manifest path: ${rel}`);
  }
  const full = resolve(root, rel);
  const back = relative(resolve(root), full);
  if (back.startsWith(".."+sep) || back === "..") throw new Error(`Path escapes bundle: ${rel}`);
  return full;
}
async function main() {
  const root = resolve(process.env.BACKUP_VERIFY_DIR || "./shelflife-backup");
  const key = Buffer.from(required("BACKUP_ENCRYPTION_KEY_BASE64"), "base64");
  if (key.length !== 32) throw new Error("Recovery key must decode to exactly 32 bytes");
  const sidecar = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (sidecar.format !== "shelflife-independent-backup-v1" || !Array.isArray(sidecar.files)) {
    throw new Error("Unsupported or malformed backup manifest");
  }
  const verified = [];
  let innerManifest = null;
  for (const item of sidecar.files) {
    if (!Number.isSafeInteger(item.encrypted_bytes) || !/^[a-f0-9]{64}$/.test(item.encrypted_sha256 || "") ||
        !Number.isSafeInteger(item.plaintext_bytes) || !/^[a-f0-9]{64}$/.test(item.plaintext_sha256 || "")) {
      throw new Error(`Invalid checksum metadata for ${item.path}`);
    }
    const encrypted = await readFile(safeBundlePath(root, item.path));
    if (encrypted.length !== item.encrypted_bytes || sha(encrypted) !== item.encrypted_sha256) {
      throw new Error(`Encrypted object checksum/size mismatch: ${item.path}`);
    }
    const plain = decryptBuffer(encrypted, key);
    if (plain.length !== item.plaintext_bytes || sha(plain) !== item.plaintext_sha256) {
      throw new Error(`Decrypted object checksum/size mismatch: ${item.path}`);
    }
    if (item.path === "manifest.json.slbk") {
      innerManifest = JSON.parse(plain.toString("utf8"));
    }
    verified.push(item.path);
  }
  if (!innerManifest || innerManifest.format !== sidecar.format || innerManifest.capture_id !== sidecar.capture_id) {
    throw new Error("Encrypted manifest does not match the public sidecar capture identity");
  }
  if (sidecar.status !== "INCOMPLETE") {
    throw new Error("Unexpected status: review recovery acceptance policy before treating this bundle as complete");
  }
  console.log(JSON.stringify({
    result: "KEY_RECOVERY_AND_LOCAL_INTEGRITY_VERIFIED",
    capture_id: sidecar.capture_id,
    encrypted_objects_verified: verified.length,
    plaintext_written_to_disk: false,
    source_restore_performed: false,
    backup_status: sidecar.status,
    gaps: sidecar.gaps
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
