import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActorExportMessage } from './actorBackupValidation.js';

const valid = (overrides = {}) => ({
  type: 'backup_export',
  group_id: 'group-1',
  messages: [{ id: 'm1', body: 'hello' }],
  history_limit: 300,
  potentially_truncated: false,
  ...overrides,
});

test('accepts a well-formed actor export for the requested group', () => {
  const result = validateActorExportMessage(valid(), 'group-1');
  assert.equal(result.group_id, 'group-1');
  assert.equal(result.messages.length, 1);
  assert.equal(result.potentially_truncated, false);
});

test('rejects a response for a different group', () => {
  assert.throws(() => validateActorExportMessage(valid({ group_id: 'other' }), 'group-1'), /does not match/);
});

test('rejects missing, malformed, or oversized message arrays', () => {
  assert.throws(() => validateActorExportMessage(valid({ messages: null }), 'group-1'), /message list/);
  assert.throws(() => validateActorExportMessage(valid({ messages: Array.from({ length: 301 }, (_, i) => ({ id: String(i) })) }), 'group-1'), /message list/);
});

test('rejects missing and duplicate message IDs', () => {
  assert.throws(() => validateActorExportMessage(valid({ messages: [{ body: 'no id' }] }), 'group-1'), /without a valid ID/);
  assert.throws(() => validateActorExportMessage(valid({ messages: [{ id: 'same' }, { id: 'same' }] }), 'group-1'), /duplicate message IDs/);
});

test('rejects retention-contract and truncation-flag mismatches', () => {
  assert.throws(() => validateActorExportMessage(valid({ history_limit: 120 }), 'group-1'), /retention limit/);
  assert.throws(() => validateActorExportMessage(valid({ potentially_truncated: true }), 'group-1'), /truncation indicator/);
});

test('marks exactly 300 retained messages as potentially truncated', () => {
  const messages = Array.from({ length: 300 }, (_, i) => ({ id: 'm' + i }));
  const result = validateActorExportMessage(valid({ messages, potentially_truncated: true }), 'group-1');
  assert.equal(result.messages.length, 300);
  assert.equal(result.potentially_truncated, true);
});
