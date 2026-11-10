function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function readRecoveryKey(text) {
  const keyMatch = text.match(/Recovery key \\(keep private\\):?\\s*\\n([A-Za-z0-9+/=]+)/);
  const idMatch = text.match(/Key ID \\(SHA-256 fingerprint\\):\\s*([a-f0-9]{64})/i);
  if (!keyMatch || !idMatch) throw new Error('The selected file is not a recognised ShelfLife recovery-key file.');
  const raw = fromBase64(keyMatch[1].trim());
  if (raw.length !== 32) throw new Error('The recovery key must decode to exactly 32 bytes.');
  const actualId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actualId !== idMatch[1].toLowerCase()) throw new Error('The recovery-key fingerprint does not match the key bytes.');
  return { raw, keyId: actualId };
}

export async function encryptBundle(bundle, keyFile) {
  const keyInfo = await readRecoveryKey(await keyFile.text());
  const key = await crypto.subtle.importKey('raw', keyInfo.raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const plaintextHash = new Uint8Array(await crypto.subtle.digest('SHA-256', plaintext));
  const ciphertextHash = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  return {
    format: 'shelflife-actor-state-backup-v1',
    algorithm: 'AES-256-GCM',
    key_id: keyInfo.keyId,
    created_at: new Date().toISOString(),
    iv_base64: toBase64(iv),
    plaintext_sha256: Array.from(plaintextHash, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ciphertext_sha256: Array.from(ciphertextHash, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ciphertext_base64: toBase64(ciphertext),
  };
}
