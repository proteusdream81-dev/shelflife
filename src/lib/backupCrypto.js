const FORMAT = 'shelflife-encrypted-backup-v1';
const ITERATIONS = 310000;

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string' || !value) throw new Error('Invalid encrypted backup encoding');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(passphrase, salt, cryptoImpl, usage) {
  const encoder = new TextEncoder();
  const material = await cryptoImpl.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return cryptoImpl.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function encryptBackup(payload, passphrase, cryptoImpl = globalThis.crypto) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Backup passphrase must contain at least 16 characters');
  }
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) {
    throw new Error('Web Crypto is unavailable in this environment');
  }
  const encoder = new TextEncoder();
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, cryptoImpl, 'encrypt');
  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    format: FORMAT,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackup(envelope, passphrase, cryptoImpl = globalThis.crypto) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Backup passphrase must contain at least 16 characters');
  }
  if (!cryptoImpl?.subtle) throw new Error('Web Crypto is unavailable in this environment');
  if (
    !envelope ||
    envelope.format !== FORMAT ||
    envelope.cipher !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== ITERATIONS
  ) {
    throw new Error('Unsupported or invalid encrypted backup format');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
    throw new Error('Encrypted backup is truncated or malformed');
  }
  const key = await deriveKey(passphrase, salt, cryptoImpl, 'decrypt');
  const plaintext = await cryptoImpl.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
