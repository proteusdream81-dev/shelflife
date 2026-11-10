import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const CHUNK_SIZE = 50;
const ROOM_TIMEOUT_MS = 45000;

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

function readRecoveryKey(text) {
  const keyMatch = text.match(/Recovery key \(keep private\)\s*\n([A-Za-z0-9+/=]+)/);
  const idMatch = text.match(/Key ID \(SHA-256 fingerprint\):\s*([a-f0-9]{64})/i);
  if (!keyMatch || !idMatch) throw new Error('The selected file is not a recognised ShelfLife recovery-key file.');
  const raw = fromBase64(keyMatch[1].trim());
  if (raw.length !== 32) throw new Error('The recovery key must decode to exactly 32 bytes.');
  return { raw, keyId: idMatch[1].toLowerCase() };
}

async function encryptBundle(bundle, keyFile) {
  const keyInfo = readRecoveryKey(await keyFile.text());
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

function downloadEncryptedFile(envelope) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `shelflife-actor-state-encrypted-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportRoom(room) {
  return new Promise((resolve, reject) => {
    const connection = base44.actors.BookGroupRoom(room.id).connect();
    let subscription;
    let started = false;
    let settled = false;
    let expectedOffset = 0;
    const messages = [];
    const timeout = setTimeout(() => finish(new Error(`Timed out exporting “${room.name}”.`)), ROOM_TIMEOUT_MS);

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.unsubscribe();
      connection.close();
      if (error) reject(error);
      else resolve({ id: room.id, name: room.name, messages: result });
    };

    subscription = connection.subscribe((event) => {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'history' && !started) {
        started = true;
        connection.send({ type: 'admin_export', offset: 0, limit: CHUNK_SIZE });
        return;
      }
      if (event.type === 'admin_export_error') {
        finish(new Error(event.error || `Export denied for “${room.name}”.`));
        return;
      }
      if (event.type !== 'admin_export_chunk') return;
      if (event.room_id !== room.id || event.offset !== expectedOffset || !Array.isArray(event.messages)) {
        finish(new Error(`Invalid export chunk received for “${room.name}”.`));
        return;
      }
      messages.push(...event.messages);
      expectedOffset += event.messages.length;
      if (event.has_more) {
        if (event.messages.length === 0 || expectedOffset >= event.total) {
          finish(new Error(`Inconsistent export pagination for “${room.name}”.`));
          return;
        }
        connection.send({ type: 'admin_export', offset: expectedOffset, limit: CHUNK_SIZE });
      } else {
        if (expectedOffset !== event.total) {
          finish(new Error(`Message count mismatch for “${room.name}”.`));
          return;
        }
        finish(null, messages);
      }
    });
  });
}

export default function AdminActorBackup() {
  const { user, isLoadingAuth } = useAuth();
  const [keyFile, setKeyFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  if (isLoadingAuth) return <main className="min-h-screen p-6">Checking administrator access…</main>;
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  const runExport = async () => {
    if (!keyFile) {
      setError('Select the saved ShelfLife recovery-key file before exporting.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('Checking group-room inventory…');
    try {
      const { data } = await base44.functions.invoke('adminListBookGroupRooms', {});
      if (!data?.ok || !Array.isArray(data.groups) || data.count !== data.groups.length) {
        throw new Error(data?.error || 'The group-room inventory was incomplete.');
      }

      const exported = [];
      for (let index = 0; index < data.groups.length; index += 1) {
        const room = data.groups[index];
        setStatus(`Exporting room ${index + 1} of ${data.groups.length}: ${room.name}`);
        exported.push(await exportRoom(room));
      }

      const bundle = {
        format: 'shelflife-actor-state-plaintext-v1',
        captured_at: new Date().toISOString(),
        source: 'Base44 BookGroupRoom actor storage',
        room_count: exported.length,
        retained_message_count: exported.reduce((total, room) => total + room.messages.length, 0),
        retention_limit_per_room: 300,
        rooms: exported,
        limitations: [
          'Only currently enumerable BookGroup records are included.',
          'Only messages still retained by each actor at capture time are included (maximum 300 per room).',
          'Messages previously evicted by the actor retention limit cannot be recovered.',
          'Actor rooms whose BookGroup records were deleted are not discoverable through this inventory.',
          'This actor export is a point-in-time per-room read, not an atomic cross-room snapshot.',
        ],
      };

      setStatus('Encrypting the export in this browser…');
      const envelope = await encryptBundle(bundle, keyFile);
      downloadEncryptedFile(envelope);
      setStatus(`Encrypted export created: ${exported.length} rooms, ${bundle.retained_message_count} retained messages.`);
    } catch (exportError) {
      setError(exportError?.message || 'Actor export failed.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ShelfLife-TBR · Recovery tools</p>
        <h1 className="mt-2 text-2xl font-semibold">Encrypted group-chat archive</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This admin-only tool reads the messages still retained in each BookGroupRoom actor and encrypts the bundle in this browser with your saved AES-256 recovery key. Only the encrypted file is downloaded.
        </p>

        <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <strong>Important limitations</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Each room retains at most 300 messages. Older evicted messages cannot be recovered.</li>
            <li>Only rooms with a current BookGroup record are enumerated.</li>
            <li>Rooms are read one at a time; this is not an atomic snapshot.</li>
            <li>This creates an encrypted archive file only. It does not upload to R2 or pause app writes.</li>
          </ul>
        </div>

        <label className="mt-6 block text-sm font-medium" htmlFor="recovery-key">Saved recovery-key file</label>
        <input
          id="recovery-key"
          className="mt-2 block w-full text-sm"
          type="file"
          accept=".txt,text/plain"
          disabled={busy}
          onChange={(event) => setKeyFile(event.target.files?.[0] || null)}
        />
        <p className="mt-2 text-xs text-muted-foreground">The key is read locally in this browser and is never sent to Base44 or Cloudflare.</p>

        <button
          type="button"
          onClick={runExport}
          disabled={busy || !keyFile}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Exporting and encrypting…' : 'Create encrypted actor archive'}
        </button>

        {status && <p className="mt-4 text-sm" role="status">{status}</p>}
        {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
      </section>
    </main>
  );
}
