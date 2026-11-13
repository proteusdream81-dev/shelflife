import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptBackup, encryptBackup } from './backupCrypto.js';

const passphrase = 'shelflife-test-passphrase-2026';

test('encrypted backup decrypts to the exact original payload', async () => {
  const payload = {
    manifest: { completeness: 'INCOMPLETE', entity_counts: { Book: 3, User: 1 } },
    entities: { Book: [{ id: 'book-1', title: 'Test title' }] },
  };
  const envelope = await encryptBackup(payload, passphrase, webcrypto);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.deepEqual(await decryptBackup(envelope, passphrase, webcrypto), payload);
});

test('wrong passphrase is rejected by AES-GCM authentication', async () => {
  const envelope = await encryptBackup({ marker: 'private' }, passphrase, webcrypto);
  await assert.rejects(
    decryptBackup(envelope, 'different-passphrase-2026', webcrypto),
  );
});

test('modified ciphertext is rejected by AES-GCM authentication', async () => {
  const envelope = await encryptBackup({ marker: 'private' }, passphrase, webcrypto);
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 1;
  const tampered = { ...envelope, ciphertext: bytes.toString('base64') };
  await assert.rejects(decryptBackup(tampered, passphrase, webcrypto));
});

test('unsupported format and short passphrases are rejected', async () => {
  await assert.rejects(encryptBackup({}, 'short', webcrypto), /16 characters/);
  await assert.rejects(
    decryptBackup({ format: 'unknown' }, passphrase, webcrypto),
    /Unsupported or invalid/,
  );
});
