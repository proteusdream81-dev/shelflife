import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

globalThis.crypto ??= webcrypto;

const actorSource = await readFile(new URL('../base44/actors/BookGroupRoom/entry.ts', import.meta.url), 'utf8');
const actorCode = actorSource
  .replace(/^import \{ Actor \} from 'base44:runtime\/actors';\s*/m, '')
  .replace('export default class BookGroupRoom extends Actor', 'class BookGroupRoom extends Actor') +
  '\nexport default BookGroupRoom;';

class MockActorRuntime {
  constructor() {
    this.instanceId = 'room-test';
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
const actorModuleUrl = 'data:text/javascript;base64,' + Buffer.from(
  actorCode.replace('extends Actor', 'extends globalThis.__MockActorRuntime'),
).toString('base64');
const { default: BookGroupRoom } = await import(actorModuleUrl);

function makeConnection(id, userId) {
  return {
    id,
    identity: { type: 'authenticated', userId },
    sent: [],
    rejected: [],
    send(event) { this.sent.push(event); },
    reject(code, reason) { this.rejected.push({ code, reason }); },
  };
}

function makeRoom({ group, users }) {
  const room = new BookGroupRoom();
  room.groups = { 'room-test': group };
  room.users = users;
  return room;
}

test('administrator can connect to a private room for recovery; ordinary non-member is denied', async () => {
  const group = { id: 'room-test', is_private: true, created_by_id: 'owner', member_ids: ['member'], blocked_ids: [] };
  const adminRoom = makeRoom({ group, users: { admin: { role: 'admin' } } });
  const admin = makeConnection('admin-conn', 'admin');
  await adminRoom.handleConnect(admin);
  assert.equal(admin.rejected.length, 0);
  assert.equal(admin.sent[0].type, 'history');

  const memberRoom = makeRoom({ group, users: { outsider: { role: 'user' } } });
  const outsider = makeConnection('outsider-conn', 'outsider');
  await memberRoom.handleConnect(outsider);
  assert.equal(outsider.rejected.length, 1);
  assert.match(outsider.rejected[0].reason, /invite only/i);
});

test('non-administrator cannot use the actor export command even after joining a public room', async () => {
  const room = makeRoom({
    group: { id: 'room-test', is_private: false, created_by_id: 'owner', member_ids: [], blocked_ids: [] },
    users: { reader: { role: 'user' } },
  });
  const conn = makeConnection('reader-conn', 'reader');
  await room.handleConnect(conn);
  await room.handleMessage(conn, { type: 'admin_export', offset: 0, limit: 50 });
  assert.equal(conn.sent.at(-1).type, 'admin_export_error');
  assert.match(conn.sent.at(-1).error, /administrator/i);
});

test('admin pagination preserves exact message order at 0, 1, 50, 51 and 300 messages', async () => {
  for (const count of [0, 1, 50, 51, 300]) {
    const room = makeRoom({
      group: { id: 'room-test', is_private: true, created_by_id: 'owner', member_ids: [], blocked_ids: [] },
      users: { admin: { role: 'admin' } },
    });
    room.messages = Array.from({ length: count }, (_, i) => ({ id: 'm' + i, body: 'message ' + i }));
    const conn = makeConnection('admin-' + count, 'admin');
    await room.handleConnect(conn);
    const collected = [];
    let offset = 0;
    let finalChunk;
    do {
      await room.handleMessage(conn, { type: 'admin_export', offset, limit: 50 });
      finalChunk = conn.sent.at(-1);
      assert.equal(finalChunk.type, 'admin_export_chunk');
      assert.equal(finalChunk.offset, offset);
      assert.ok(finalChunk.messages.length <= 50);
      collected.push(...finalChunk.messages);
      offset += finalChunk.messages.length;
      if (finalChunk.has_more) assert.ok(finalChunk.messages.length > 0);
    } while (finalChunk.has_more);
    assert.equal(collected.length, count);
    assert.deepEqual(collected.map((m) => m.id), room.messages.map((m) => m.id));
  }
});

test('admin export pagination uses a stable per-connection snapshot while live chat continues', async () => {
  const room = makeRoom({
    group: { id: 'room-test', is_private: true, created_by_id: 'owner', member_ids: [], blocked_ids: [] },
    users: { admin: { role: 'admin' } },
  });
  room.messages = Array.from({ length: 51 }, (_, i) => ({ id: 'old-' + i }));
  const conn = makeConnection('admin-snapshot', 'admin');
  await room.handleConnect(conn);
  await room.handleMessage(conn, { type: 'admin_export', offset: 0, limit: 50 });
  assert.equal(conn.sent.at(-1).messages.length, 50);
  room.messages.push({ id: 'new-live-message' });
  await room.handleMessage(conn, { type: 'admin_export', offset: 50, limit: 50 });
  const last = conn.sent.at(-1);
  assert.deepEqual(last.messages.map((m) => m.id), ['old-50']);
  assert.equal(last.total, 51);
  assert.equal(last.has_more, false);
});

test('normal group chat still accepts and persists a member message', async () => {
  const room = makeRoom({
    group: { id: 'room-test', is_private: false, created_by_id: 'owner', member_ids: ['reader'], blocked_ids: [] },
    users: { reader: { role: 'user', full_name: 'Test Reader' } },
  });
  const conn = makeConnection('member-conn', 'reader');
  await room.handleConnect(conn);
  await room.handleMessage(conn, { type: 'message', body: '  hello   group  ', author_name: 'ignored label' });
  assert.equal(room.persisted.length, 1);
  assert.equal(room.persisted[0].body, 'hello group');
  assert.equal(room.persisted[0].author_id, 'reader');
  assert.equal(room.persisted[0].author_name, 'Test Reader');
  assert.equal(room.events.at(-1).type, 'message');
});

test('actor inventory function denies unauthenticated/non-admin users and paginates for an admin', async () => {
  const source = await readFile(new URL('../base44/functions/adminListBookGroupRooms/entry.ts', import.meta.url), 'utf8');
  const code = source
    .replace(/^import \{ createClientFromRequest \} from 'npm:@base44\/sdk@0\.8\.59';\s*/m, 'const createClientFromRequest = globalThis.__testCreateClientFromRequest;\n')
    .replace('export default async function (req)', 'async function handler(req)') +
    '\nexport default handler;';
  globalThis.__testCreateClientFromRequest = (req) => req.__base44;
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const { default: handler } = await import(url);

  const unauth = await handler({ __base44: { auth: { me: async () => { throw new Error('no auth'); } } } });
  assert.equal(unauth.status, 401);
  const denied = await handler({ __base44: { auth: { me: async () => ({ role: 'user' }) } } });
  assert.equal(denied.status, 403);

  const groups = Array.from({ length: 201 }, (_, i) => ({ id: 'g' + i, name: 'Group ' + i }));
  let calls = 0;
  const base44 = {
    auth: { me: async () => ({ role: 'admin' }) },
    asServiceRole: { entities: { BookGroup: { list: async (_sort, limit, skip) => {
      calls += 1;
      return groups.slice(skip, skip + limit);
    } } } },
  };
  const response = await handler({ __base44: base44 });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.count, 201);
  assert.equal(body.groups.length, 201);
  assert.equal(calls, 4);
});

test('inventory function rejects an unstable two-pass group inventory', async () => {
  const source = await readFile(new URL('../base44/functions/adminListBookGroupRooms/entry.ts', import.meta.url), 'utf8');
  const code = source
    .replace(/^import \{ createClientFromRequest \} from 'npm:@base44\/sdk@0\.8\.59';\s*/m, 'const createClientFromRequest = globalThis.__testCreateClientFromRequest;\n')
    .replace('export default async function (req)', 'async function handler(req)') +
    '\nexport default handler;';
  globalThis.__testCreateClientFromRequest = (req) => req.__base44;
  const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  let pass = 0;
  const response = await handler({ __base44: {
    auth: { me: async () => ({ role: 'admin' }) },
    asServiceRole: { entities: { BookGroup: { list: async () => [{ id: 'g1', name: 'Name ' + (++pass) }] } } },
  } });
  assert.equal(response.status, 409);
});

test('AES-256-GCM archive decrypts independently and restores into isolated actor storage', async () => {
  const { encryptBundle } = await import('../src/lib/actorBackupCrypto.js');
  const key = Buffer.alloc(32, 0x5a);
  const keyId = createHash('sha256').update(key).digest('hex');
  const keyText = 'Recovery key (keep private):\n' + key.toString('base64') + '\nKey ID (SHA-256 fingerprint): ' + keyId + '\n';
  const bundle = {
    format: 'shelflife-actor-state-plaintext-v1',
    room_count: 1,
    retained_message_count: 2,
    rooms: [{ id: 'room-test', name: 'Test room', messages: [{ id: 'm1', body: 'one' }, { id: 'm2', body: 'two' }] }],
  };
  const envelope = await encryptBundle(bundle, { text: async () => keyText });
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.equal(Buffer.from(envelope.iv_base64, 'base64').length, 12);

  const iv = Buffer.from(envelope.iv_base64, 'base64');
  const encrypted = Buffer.from(envelope.ciphertext_base64, 'base64');
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  assert.equal(createHash('sha256').update(plaintext).digest('hex'), envelope.plaintext_sha256);
  assert.equal(createHash('sha256').update(encrypted).digest('hex'), envelope.ciphertext_sha256);
  const restored = JSON.parse(plaintext.toString('utf8'));
  assert.deepEqual(restored, bundle);

  const restoreRoom = new BookGroupRoom();
  restoreRoom.persisted = [];
  restoreRoom.storage = { get: async () => restoreRoom.persisted, put: async (_key, value) => { restoreRoom.persisted = structuredClone(value); } };
  restoreRoom.messages = restored.rooms[0].messages;
  await restoreRoom.storage.put('messages', restoreRoom.messages);
  const reopenedRoom = new BookGroupRoom();
  reopenedRoom.persisted = restoreRoom.persisted;
  reopenedRoom.storage = { get: async () => reopenedRoom.persisted, put: async (_key, value) => { reopenedRoom.persisted = structuredClone(value); } };
  reopenedRoom.getConnections = () => [];
  reopenedRoom.loadGroup = async () => null;
  await reopenedRoom.handleStart();
  assert.deepEqual(reopenedRoom.messages, bundle.rooms[0].messages);
});
