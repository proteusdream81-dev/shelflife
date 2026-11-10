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
test("record digest is order independent and binds update timestamps", () => {
  const a = [{id:"b",updated_date:"2026-01-01"},{id:"a",updated_date:"2026-01-02"}];
  assert.equal(digestRecords(a), digestRecords([...a].reverse()));
  assert.notEqual(digestRecords(a), digestRecords([{...a[0],updated_date:"2026-01-03"},a[1]]));
});
