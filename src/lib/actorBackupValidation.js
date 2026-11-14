export const ACTOR_MESSAGE_RETENTION_LIMIT = 300;

export function validateActorExportMessage(message, expectedGroupId) {
  if (!message || typeof message !== 'object' || message.type !== 'backup_export') {
    throw new Error('Invalid actor backup response type.');
  }
  if (typeof expectedGroupId !== 'string' || !expectedGroupId || message.group_id !== expectedGroupId) {
    throw new Error('Actor backup response does not match the requested group.');
  }
  if (!Array.isArray(message.messages) || message.messages.length > ACTOR_MESSAGE_RETENTION_LIMIT) {
    throw new Error('Actor backup returned an invalid retained-message list.');
  }
  if (message.history_limit !== ACTOR_MESSAGE_RETENTION_LIMIT) {
    throw new Error('Actor backup retention limit does not match the expected source contract.');
  }
  const ids = new Set();
  for (const item of message.messages) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('Actor backup contains a message without a valid ID.');
    }
    if (ids.has(item.id)) {
      throw new Error('Actor backup contains duplicate message IDs.');
    }
    ids.add(item.id);
  }
  const expectedTruncationFlag = message.messages.length >= ACTOR_MESSAGE_RETENTION_LIMIT;
  if (message.potentially_truncated !== expectedTruncationFlag) {
    throw new Error('Actor backup truncation indicator is inconsistent with its retained-message count.');
  }
  return {
    group_id: message.group_id,
    messages: message.messages,
    history_limit: message.history_limit,
    potentially_truncated: message.potentially_truncated,
  };
}
