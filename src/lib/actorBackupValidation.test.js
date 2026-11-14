import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActorExportChunk } from './actorBackupValidation.js';

const chunk = (overrides = {}) => ({
  type: 'backup_export_chunk',
  group_id: 'group-1',
  offset: 0,
  total: 1,
  messages: [{ id: 'm1', body: 'hello' }],
  has_more: false,
  history_limit: 300,
  potentially_truncated: false,
  ...overrides,
});

test('accepts a well-formed final actor export chunk', () => {
  const result = validateActorExportChunk(chunk(), 'group-1', 0);
  assert.equal(result.group_id, 'group-1');
  assert.equal(result.messages.length, 1);
  assert.equal(result.has_more, false);
});

test('accepts empty room snapshots and the final chunk at the retention boundary', () => {
  assert.equal(validateActorExportChunk(chunk({ total: 0, messages: [] }), 'group-1', 0).messages.length, 0);
  const messages = Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i }));
  const result = validateActorExportChunk(chunk({
    total: 300, messages, has_more: true, potentially_truncated: true,
  }), 'group-1', 0);
  assert.equal(result.messages.length, 50);
  assert.equal(result.potentially_truncated, true);
});

test('rejects a response for a different group or out-of-sequence offset', () => {
  assert.throws(() => validateActorExportChunk(chunk({ group_id: 'other' }), 'group-1', 0), /does not match/);
  assert.throws(() => validateActorExportChunk(chunk({ offset: 50 }), 'group-1', 0), /offset/);
});

test('rejects missing, malformed, oversized and overrun message arrays', () => {
  assert.throws(() => validateActorExportChunk(chunk({ messages: null }), 'group-1', 0), /message list/);
  assert.throws(() => validateActorExportChunk(chunk({ messages: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })), total: 51, has_more: false }), 'group-1', 0), /message list/);
  assert.throws(() => validateActorExportChunk(chunk({ total: 0 }), 'group-1', 0), /message list/);
});

test('rejects missing and duplicate message IDs', () => {
  assert.throws(() => validateActorExportChunk(chunk({ messages: [{ body: 'no id' }] }), 'group-1', 0), /without a valid ID/);
  assert.throws(() => validateActorExportChunk(chunk({ total: 2, messages: [{ id: 'same' }, { id: 'same' }] }), 'group-1', 0), /duplicate message IDs/);
});

test('rejects retention-contract, truncation and continuation mismatches', () => {
  assert.throws(() => validateActorExportChunk(chunk({ history_limit: 120 }), 'group-1', 0), /retention limit/);
  assert.throws(() => validateActorExportChunk(chunk({ total: 300, potentially_truncated: false }), 'group-1', 0), /truncation indicator/);
  assert.throws(() => validateActorExportChunk(chunk({ has_more: true }), 'group-1', 0), /continuation flag/);
  assert.throws(() => validateActorExportChunk(chunk({ total: 51, messages: [], has_more: true }), 'group-1', 0), /continuation flag/);
});

test('accepts the correctly sequenced final page', () => {
  const result = validateActorExportChunk(chunk({
    offset: 50, total: 51, messages: [{ id: 'm50' }], has_more: false,
  }), 'group-1', 50);
  assert.equal(result.offset, 50);
  assert.equal(result.total, 51);
});
