import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateActorExportChunk } from './actorBackupValidation.js';

const source = await readFile(new URL('../../base44/actors/BookGroupRoom/entry.ts', import.meta.url), 'utf8');
const actorCode = source
  .replace(/^import \\{ Actor \\} from 'base44:runtime\\/actors';\\s*/m, '')
  .replace('export default class BookGroupRoom extends Actor', 'class BookGroupRoom extends Actor') +
  '\\nexport default BookGroupRoom;';

class MockActorRuntime {
  constructor() {
    this.instanceId = 'group-1';
    this.connections = [];
    this.events = [];
    this.persisted = [];
    this.storage = {
      get: async () => this.persisted,
      put: async (_key, value) => { this.persisted = structuredClone(value); },
    };
    this.client = { asServiceRole: { entities: {
      User: { get: async (id) => this.users?.[id] ?? null },
      BookGroup: { get: async (id) => this.groups?.[id] ?? null },
    } } };
  }
  getConnections() { return this.connections; }
  broadcast(event) { this.events.push(event); }
}

globalThis.__MockActorRuntime = MockActorRuntime;
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(
  actorCode.replace('extends Actor', 'extends globalThis.__MockActorRuntime'),
).toString('base64');
const { default: BookGroupRoom } = await import(moduleUrl);

function connection(id, userId, role = 'admin') {
  return {
    id,
    identity: { type: 'authenticated', userId },
    sent: [],
    rejected: [],
    send(event) { this.sent.push(event); },
    reject(code, reason) { this.rejected.push({ code, reason }); },
  };
}

function roomWithMessages(count) {
  const room = new BookGroupRoom();
  room.users = { admin: { role: 'admin' }, reader: { role: 'user' } };
  room.persisted = Array.from({ length: count }, (_, i) => ({ id: 'm' + i, body: 'message ' + i }));
  room.messages = room.persisted.slice();
  return room;
}

async function openAdmin(room, id = 'backup-export-test') {
  const conn = connection(id, 'admin');
  await room.handleConnect(conn);
  assert.equal(conn.rejected.length, 0);
  assert.equal(conn.sent[0].type, 'backup_ready');
  return conn;
}

test('actor export is admin-only and uses a dedicated non-reader connection', async () => {
  const room = roomWithMessages(1);
  const denied = connection('backup-export-reader', 'reader');
  await room.handleConnect(denied);
  assert.equal(denied.rejected.length, 1);
  assert.equal(denied.rejected[0].code, 4003);
  assert.equal(room.adminExports.size, 0);

  const admin = await openAdmin(room);
  assert.equal(room.adminExports.has(admin.id), true);
  assert.equal(room.readers.has(admin.id), false);
});

test('actor returns ordered 50-message chunks for 0, 1, 50, 51 and 300 retained messages', async () => {
  for (const count of [0, 1, 50, 51, 300]) {
    const room = roomWithMessages(count);
    const conn = await openAdmin(room, 'backup-export-' + count);
    const collected = [];
    let offset = 0;
    let response;
    do {
      await room.handleMessage(conn, { type: 'backup_export', offset, limit: 50 });
      response = conn.sent.at(-1);
      const valid = validateActorExportChunk(response, room.instanceId, offset);
      assert.equal(valid.total, count);
      collected.push(...valid.messages);
      offset += valid.messages.length;
    } while (response.has_more);
    assert.equal(collected.length, count);
    assert.deepEqual(collected.map((m) => m.id), room.messages.map((m) => m.id));
    assert.equal(room.exportSnapshots.has(conn.id), false);
  }
});

test('actor snapshot remains stable while normal room messages continue', async () => {
  const room = roomWithMessages(51);
  const conn = await openAdmin(room);
  await room.handleMessage(conn, { type: 'backup_export', offset: 0, limit: 50 });
  assert.equal(conn.sent.at(-1).messages.length, 50);

  room.messages.push({ id: 'live-new', body: 'new message' });
  room.persisted = room.messages.slice();
  await room.handleMessage(conn, { type: 'backup_export', offset: 50, limit: 50 });
  const last = conn.sent.at(-1);
  assert.equal(last.total, 51);
  assert.deepEqual(last.messages.map((m) => m.id), ['m50']);
  assert.equal(last.has_more, false);
});

test('actor rejects invalid page sizes, offsets and out-of-order requests', async () => {
  const room = roomWithMessages(51);
  const conn = await openAdmin(room);
  await room.handleMessage(conn, { type: 'backup_export', offset: 0, limit: 51 });
  assert.equal(conn.sent.at(-1).type, 'backup_export_error');

  await room.handleMessage(conn, { type: 'backup_export', offset: 0, limit: 50 });
  assert.equal(conn.sent.at(-1).type, 'backup_export_chunk');
  await room.handleMessage(conn, { type: 'backup_export', offset: 10, limit: 50 });
  assert.equal(conn.sent.at(-1).type, 'backup_export_error');
  assert.equal(room.exportSnapshots.has(conn.id), false);
});

test('actor rechecks administrator role for every chunk and clears the snapshot on close', async () => {
  const room = roomWithMessages(51);
  const conn = await openAdmin(room);
  await room.handleMessage(conn, { type: 'backup_export', offset: 0, limit: 50 });
  assert.equal(room.exportSnapshots.has(conn.id), true);

  room.users.admin.role = 'user';
  await room.handleMessage(conn, { type: 'backup_export', offset: 50, limit: 50 });
  assert.equal(conn.sent.at(-1).type, 'error');
  assert.equal(room.adminExports.has(conn.id), false);
  assert.equal(room.exportSnapshots.has(conn.id), false);

  await room.handleClose(conn);
  assert.equal(room.exportSnapshots.has(conn.id), false);
});
