import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { encryptBackup } from '@/lib/backupCrypto';
import { validateActorExportChunk } from '@/lib/actorBackupValidation';

const EXPORTABLE_ENTITIES = [
  'GroupInvite',
  'Book',
  'Follow',
  'Comment',
  'BookGroup',
  'ReaderSearch',
  'BookSearchCache',
  'WaitlistAttempt',
  'AccountDeletionRequest',
  'Report',
  'RateLimitHit',
  'Block',
  'PlacesCache',
  'Shelf',
  'Waitlist',
  'ClubSearchCache',
  'ReleaseReminder',
  'User',
];
const PAGE_SIZE = 500;
const ACTOR_TIMEOUT_MS = 20000;



function exportActorRoom(group) {
  return new Promise((resolve, reject) => {
    const room = base44.actors.BookGroupRoom(group.id).connect({
      id: `backup-export-${crypto.randomUUID()}`,
    });
    let subscription;
    let settled = false;
    let expectedTotal = null;
    let nextOffset = 0;
    const collected = [];
    const seenIds = new Set();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      subscription?.unsubscribe();
      room.close();
      callback(value);
    };
    const timeout = window.setTimeout(
      () => finish(reject, new Error(`Timed out exporting group room ${group.id}`)),
      ACTOR_TIMEOUT_MS,
    );

    subscription = room.subscribe((message) => {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'backup_ready') {
        if (message.group_id !== group.id) {
          finish(reject, new Error('Actor export readiness response does not match the requested group.'));
          return;
        }
        room.send({ type: 'backup_export', offset: 0, limit: 50 });
      } else if (message.type === 'backup_export_chunk') {
        try {
          const validated = validateActorExportChunk(message, group.id, nextOffset);
          if (expectedTotal === null) expectedTotal = validated.total;
          if (validated.total !== expectedTotal) {
            throw new Error('Actor backup total changed during the room snapshot.');
          }
          for (const item of validated.messages) {
            if (seenIds.has(item.id)) throw new Error('Actor backup contains duplicate message IDs across chunks.');
            seenIds.add(item.id);
            collected.push(item);
          }
          nextOffset += validated.messages.length;
          if (validated.has_more) {
            room.send({ type: 'backup_export', offset: nextOffset, limit: 50 });
            return;
          }
          if (collected.length !== expectedTotal) {
            throw new Error('Actor backup ended before every retained message was captured.');
          }
          finish(resolve, {
            group_id: group.id,
            group_name: group.name,
            is_private: group.is_private,
            messages: collected,
            history_limit: validated.history_limit,
            potentially_truncated: validated.potentially_truncated,
          });
        } catch (validationError) {
          finish(reject, validationError);
        }
      } else if (message.type === 'backup_export_error' || message.type === 'error') {
        finish(reject, new Error(message.error || message.text || 'Actor export was refused'));
      }
    });
  });
}

async function invokeExport(payload) {
  const response = await base44.functions.invoke('adminBookGroupBackup', payload);
  const data = response?.data ?? response;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function exportEntity(entityName) {
  const records = [];
  let skip = 0;
  let expectedCount = null;

  while (true) {
    const page = await invokeExport({
      action: 'entity_page',
      entity_name: entityName,
      skip,
      limit: PAGE_SIZE,
    });
    if (!Array.isArray(page.items) || typeof page.count !== 'number') {
      throw new Error(`Invalid export response for ${entityName}`);
    }
    if (expectedCount === null) expectedCount = page.count;
    if (page.count !== expectedCount) {
      throw new Error(`${entityName} changed during export; discard this run and retry in a write-free window`);
    }
    records.push(...page.items);
    if (records.length > expectedCount) {
      throw new Error(`${entityName} returned more records than its reported count`);
    }
    if (records.length === expectedCount) break;
    if (page.items.length === 0) {
      throw new Error(`${entityName} export stopped before all records were captured`);
    }
    skip += page.items.length;
  }

  return { count: expectedCount ?? 0, records };
}

export default function AdminBackupExport() {
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then((user) => { if (active) setAdmin(user?.role === 'admin'); })
      .catch(() => { if (active) setAdmin(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const runExport = async () => {
    if (passphrase.length < 16) {
      setError('Use a passphrase of at least 16 characters. Store it separately from the backup file.');
      return;
    }

    setBusy(true);
    setError('');
    setProgress('Starting read-only export…');
    const startedAt = new Date().toISOString();

    try {
      const groups = [];
      let groupSkip = 0;
      let expectedGroupCount = null;
      let groupInventoryComplete = false;
      while (!groupInventoryComplete) {
        const groupPage = await invokeExport({ action: 'groups', skip: groupSkip, limit: PAGE_SIZE });
        if (!Array.isArray(groupPage.groups) || typeof groupPage.count !== 'number') {
          throw new Error('Invalid group-room inventory response');
        }
        if (expectedGroupCount === null) expectedGroupCount = groupPage.count;
        if (groupPage.count !== expectedGroupCount) {
          throw new Error('BookGroup inventory changed during export; retry in a write-free window');
        }
        groups.push(...groupPage.groups);
        groupInventoryComplete = groupPage.inventory_complete === true;
        if (!groupPage.groups.length && groups.length < expectedGroupCount) {
          throw new Error('Group-room inventory stopped before every current group was enumerated');
        }
        groupSkip += groupPage.groups.length;
      }
      const groupResult = { inventory_scope: 'current BookGroup records only; deleted/orphaned actor IDs are not enumerable' };
      const actorRooms = [];

      for (let i = 0; i < groups.length; i += 1) {
        setProgress(`Exporting group-room history ${i + 1} of ${groups.length}…`);
        actorRooms.push(await exportActorRoom(groups[i]));
      }

      const entities = {};
      const entityCounts = {};
      for (let i = 0; i < EXPORTABLE_ENTITIES.length; i += 1) {
        const entityName = EXPORTABLE_ENTITIES[i];
        setProgress(`Exporting ${entityName} (${i + 1} of ${EXPORTABLE_ENTITIES.length})…`);
        const result = await exportEntity(entityName);
        entities[entityName] = result.records;
        entityCounts[entityName] = result.count;
      }

      const endedAt = new Date().toISOString();
      const possiblyTruncatedRooms = actorRooms
        .filter((room) => room.potentially_truncated)
        .map((room) => room.group_id);

      const payload = {
        manifest: {
          format_version: 1,
          source: 'ShelfLife-TBR Base44 application',
          capture_started_at: startedAt,
          capture_ended_at: endedAt,
          entity_inventory: EXPORTABLE_ENTITIES,
          entity_counts: entityCounts,
          actor_room_count: actorRooms.length,
          actor_room_inventory_count: expectedGroupCount ?? 0,
          actor_room_inventory_complete: groupInventoryComplete && actorRooms.length === (expectedGroupCount ?? 0),
          actor_room_inventory_scope: groupResult.inventory_scope,
          actor_rooms_at_message_limit: possiblyTruncatedRooms,
          actor_message_retention_limit: 300,
          completeness: 'INCOMPLETE',
          incomplete_reasons: [
            'This exporter does not place the live app into a write-free maintenance window; the capture is not guaranteed to be a point-in-time snapshot.',
            'Only rooms represented by current BookGroup records can be enumerated. Deleted or orphaned actor IDs are not discoverable through the documented actor storage interface.',
            'Each room stores at most 300 messages. Rooms at that limit may have older messages that were already discarded.',
            'This export has not been uploaded to R2, read-back checksum verified, or restored in an isolated environment.',
          ],
        },
        entities,
        actor_rooms: actorRooms,
      };

      setProgress('Encrypting backup in this browser…');
      const encrypted = await encryptBackup(payload, passphrase);
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `shelflife-backup-${startedAt.replace(/[:.]/g, '-')}.json.enc`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setProgress('Encrypted export downloaded. It is explicitly marked INCOMPLETE.');
    } catch (err) {
      setError(err?.message || 'Backup export failed. No backup file was created.');
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <main className="vp-page"><p className="vp-empty">Checking access…</p></main>;
  if (!admin) return <main className="vp-page"><section className="vp-empty"><h1>Admin access required</h1><p>This export tool is restricted to ShelfLife app administrators.</p></section></main>;

  return (
    <main className="vp-page max-w-3xl mx-auto p-4">
      <section className="vp-shelf">
        <div className="vp-shelfhead">
          <h1 className="text-xl font-semibold">ShelfLife backup export</h1>
          <span className="vp-btn vp-small">Admin only</span>
        </div>
        <p className="text-sm mt-3">
          Exports all 18 declared entities, built-in User records, and current BookGroupRoom message histories.
          Encryption happens in this browser; the passphrase is not sent to Base44.
        </p>
        <div className="vp-empty mt-4">
          <strong>Important: this export cannot be marked complete.</strong>
          <p className="text-sm mt-2">
            It does not pause application writes, cannot enumerate deleted actor rooms, and cannot recover
            messages already removed by the 300-message room retention limit. It downloads an encrypted
            working snapshot only; it does not upload to R2 or perform a restore test.
          </p>
        </div>
        <label className="block text-sm font-medium mt-5" htmlFor="backup-passphrase">
          Encryption passphrase (16 characters minimum)
        </label>
        <input
          id="backup-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="vp-input w-full mt-2"
          minLength={16}
          disabled={busy}
          placeholder="Use a unique passphrase and store it separately"
        />
        <button
          type="button"
          onClick={runExport}
          disabled={busy || passphrase.length < 16}
          className="vp-btn mt-4"
        >
          {busy ? 'Exporting…' : 'Create encrypted working export'}
        </button>
        {progress && <p className="text-sm mt-3" role="status">{progress}</p>}
        {error && <p className="text-sm text-destructive mt-3" role="alert">{error}</p>}
      </section>
    </main>
  );
}
