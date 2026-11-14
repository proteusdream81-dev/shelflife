import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptBuffer, decryptBuffer, digestRecords } from "./base44DirectExport.js";

test("AES-256-GCM export envelope round-trips", () => {
  const key = randomBytes(32), plain = Buffer.from('{"id":"book-1"}');
  assert.deepEqual(decryptBuffer(encryptBuffer(plain, key), key), plain);
});
test("AES-256-GCM rejects tampering and wrong keys", () => {
  const key = randomBytes(32), other = randomBytes(32);
  const enc = encryptBuffer(Buffer.from("secret"), key);
  const damaged = Buffer.from(enc); damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decryptBuffer(damaged, key));
  assert.throws(() => decryptBuffer(enc, other));
});
test("record digest is order independent and binds full record contents", () => {
  const a = [
    {id:"b",updated_date:"2026-01-01",title:"Original"},
    {id:"a",updated_date:"2026-01-02",title:"Another"}
  ];
  assert.equal(digestRecords(a), digestRecords([...a].reverse()));
  assert.equal(digestRecords([{id:"same",title:"Stable",updated_date:"2026-01-04"}]),
    digestRecords([{updated_date:"2026-01-04",title:"Stable",id:"same"}]));
  assert.notEqual(digestRecords(a), digestRecords([{...a[0],updated_date:"2026-01-03"},a[1]]));
  // Detect a field change even if the source update timestamp is unchanged.
  assert.notEqual(digestRecords(a), digestRecords([{...a[0],title:"Changed"},a[1]]));
});


import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

test("offline verifier recovers key and verifies every encrypted object", async () => {
  const root = await mkdtemp(join(tmpdir(), "shelflife-verify-"));
  try {
    const key = randomBytes(32);
    const capture = "fixture-capture";
    const data = Buffer.from(JSON.stringify([{id:"book-fixture"}]));
    const encryptedData = encryptBuffer(data, key);
    const entry = (path, plain, encrypted) => ({
      path, plaintext_bytes:plain.length, encrypted_bytes:encrypted.length,
      plaintext_sha256:createHash("sha256").update(plain).digest("hex"),
      encrypted_sha256:createHash("sha256").update(encrypted).digest("hex")
    });
    const dataEntry = entry("active-book.slbk",data,encryptedData);
    const inner = Buffer.from(JSON.stringify({
      format:"shelflife-independent-backup-v1", capture_id:capture,
      status:"INCOMPLETE", files:[dataEntry]
    }));
    const encryptedManifest = encryptBuffer(inner, key);
    const manifestEntry = entry("manifest.json.slbk",inner,encryptedManifest);
    await writeFile(join(root,"active-book.slbk"), encryptedData);
    await writeFile(join(root,"manifest.json.slbk"), encryptedManifest);
    const sidecar = {
      format:"shelflife-independent-backup-v1", capture_id:capture, status:"INCOMPLETE",
      gaps:["fixture"], files:[dataEntry,manifestEntry]
    };
    await writeFile(join(root,"manifest.json"),JSON.stringify(sidecar));
    const env = {
      ...process.env,
      BACKUP_ENCRYPTION_KEY_BASE64:key.toString("base64"),
      BACKUP_VERIFY_DIR:root
    };
    const result = execFileSync(process.execPath,["scripts/backup/verifyLocalBackup.js"],{env,encoding:"utf8"});
    assert.match(result,/KEY_RECOVERY_AND_LOCAL_INTEGRITY_VERIFIED/);
    assert.match(result,/plaintext_written_to_disk": false/);
    // Removing a data object from the unauthenticated sidecar must not make
    // an incomplete subset appear to be a fully verified bundle.
    const damagedSidecar = {...sidecar,files:[manifestEntry]};
    await writeFile(join(root,"manifest.json"),JSON.stringify(damagedSidecar));
    assert.throws(() => execFileSync(process.execPath,["scripts/backup/verifyLocalBackup.js"],{
      env,encoding:"utf8",stdio:"pipe"
    }));
    await writeFile(join(root,"manifest.json"),JSON.stringify(sidecar));
    assert.throws(() => execFileSync(process.execPath,["scripts/backup/verifyLocalBackup.js"],{
      env:{...env,BACKUP_ENCRYPTION_KEY_BASE64:randomBytes(32).toString("base64")},
      encoding:"utf8",stdio:"pipe"
    }));
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
