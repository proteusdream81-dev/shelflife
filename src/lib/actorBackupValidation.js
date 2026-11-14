export const ACTOR_MESSAGE_RETENTION_LIMIT = 300;
export const ACTOR_EXPORT_CHUNK_SIZE = 50;

export function validateActorExportChunk(message, expectedGroupId, expectedOffset) {
  if (!message || typeof message !== 'object' || message.type !== 'backup_export_chunk') {
    throw new Error('Invalid actor backup chunk response type.');
  }
  if (typeof expectedGroupId !== 'string' || !expectedGroupId || message.group_id !== expectedGroupId) {
    throw new Error('Actor backup chunk does not match the requested group.');
  }
  if (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0 ||
      !Number.isSafeInteger(message.offset) || message.offset !== expectedOffset) {
    throw new Error('Actor backup chunk offset is invalid or out of sequence.');
  }
  if (!Number.isSafeInteger(message.total) || message.total < 0 ||
      message.total > ACTOR_MESSAGE_RETENTION_LIMIT) {
    throw new Error('Actor backup chunk reports an invalid retained-message total.');
  }
  if (!Array.isArray(message.messages) || message.messages.length > ACTOR_EXPORT_CHUNK_SIZE ||
      message.offset + message.messages.length > message.total) {
    throw new Error('Actor backup chunk contains an invalid message list.');
  }
  if (message.history_limit !== ACTOR_MESSAGE_RETENTION_LIMIT) {
    throw new Error('Actor backup retention limit does not match the expected source contract.');
  }
  const expectedTruncationFlag = message.total >= ACTOR_MESSAGE_RETENTION_LIMIT;
  if (message.potentially_truncated !== expectedTruncationFlag) {
    throw new Error('Actor backup truncation indicator is inconsistent with its retained-message total.');
  }
  const expectedHasMore = message.offset + message.messages.length < message.total;
  if (message.has_more !== expectedHasMore ||
      (message.has_more && message.messages.length === 0)) {
    throw new Error('Actor backup chunk continuation flag is inconsistent.');
  }
  const ids = new Set();
  for (const item of message.messages) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('Actor backup contains a message without a valid ID.');
    }
    if (ids.has(item.id)) throw new Error('Actor backup chunk contains duplicate message IDs.');
    ids.add(item.id);
  }
  return {
    group_id: message.group_id,
    offset: message.offset,
    total: message.total,
    messages: message.messages,
    has_more: message.has_more,
    history_limit: message.history_limit,
    potentially_truncated: message.potentially_truncated,
  };
}
