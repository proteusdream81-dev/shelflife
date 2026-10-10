import { Actor } from 'base44:runtime/actors';

// One room per reading group: the group record id IS this room's instance id.
const MAX_READERS = 40;
const HISTORY_LIMIT = 120;
const KEEP_MESSAGES = 300;
const MAX_BODY = 1000;

const idList = (value) => (Array.isArray(value) ? value : []).map(String).filter(Boolean);

export default class BookGroupRoom extends Actor {
  readers = new Map(); // conn.id -> {} (presence only, no seats)
  messages = [];
  names = new Map(); // userId -> display name
  seq = 0;
  blocked = new Set(); // readers the owner removed — they stop posting straight away

  // Runs on ANY wake, including hibernation where sockets stay attached.
  async handleStart() {
    const saved = await this.storage.get('messages');
    if (Array.isArray(saved)) this.messages = saved;
    this.readers = new Map(this.getConnections().map((conn) => [conn.id, {}]));
    this.blocked = new Set(idList((await this.loadGroup())?.blocked_ids));
  }

  async handleConnect(conn) {
    // A group's chat is for signed-in readers: the room id is public, so nothing —
    // not even history — goes out before the platform-verified identity checks out.
    if (conn.identity?.type !== 'authenticated') {
      conn.reject(4003, 'Sign in to join this group');
      return;
    }

    const group = await this.loadGroup();
    if (!group) {
      conn.reject(4004, 'This group is no longer available');
      return;
    }

    // The group record is the truth for who may be here, so it decides per connection:
    // a reader the owner removed stays out, and a private group admits only its owner
    // and the readers listed on its guest list.
    this.blocked = new Set(idList(group.blocked_ids));
    if (this.blocked.has(conn.identity.userId)) {
      conn.reject(4004, 'The group owner removed you from this group');
      return;
    }
    if (group.is_private) {
      const invited = idList(group.member_ids);
      if (group.created_by_id !== conn.identity.userId && !invited.includes(conn.identity.userId)) {
        conn.reject(4004, 'This private group is invite only');
        return;
      }
    }

    if (!this.readers.has(conn.id) && this.readers.size >= MAX_READERS) {
      conn.reject(4001, 'This group is full right now');
      return;
    }
    this.readers.set(conn.id, {});
    conn.send({ type: 'history', messages: this.messages.slice(-HISTORY_LIMIT) });
    this.broadcastPresence();
  }

  async handleMessage(conn, msg) {
    if (typeof msg !== 'object' || msg === null) return;
    if (!this.readers.has(conn.id)) return;

    const identity = conn.identity;
    if (!identity || identity.type !== 'authenticated') {
      conn.send({ type: 'error', text: 'Sign in to post in this group.' });
      return;
    }

    // Removed readers keep quiet even while their socket is still open.
    if (this.blocked.has(identity.userId)) return;

    if (msg.type === 'moderate') {
      await this.moderate(conn, msg);
      return;
    }
    if (msg.type !== 'message') return;

    const body = String(msg.body ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY);
    if (!body) return;

    const message = {
      id: `${Date.now()}-${this.seq++}`,
      author_id: identity.userId,
      author_name: await this.displayName(identity.userId, msg.author_name),
      body,
      at: Date.now(),
    };

    this.messages.push(message);
    if (this.messages.length > KEEP_MESSAGES) this.messages = this.messages.slice(-KEEP_MESSAGES);
    await this.storage.put('messages', this.messages);
    this.broadcast({ type: 'message', message });
  }

  // The group owner moderates: deleting a message, or taking a reader out of the room.
  // Every command is checked against the group record itself, never against anything
  // the caller says about itself.
  async moderate(conn, msg) {
    const group = await this.loadGroup();
    if (!group || group.created_by_id !== conn.identity.userId) {
      conn.send({ type: 'error', text: 'Only the group owner can moderate this group.' });
      return;
    }

    if (msg.action === 'delete_message') {
      const id = String(msg.id ?? '');
      const kept = this.messages.filter((message) => message.id !== id);
      if (kept.length === this.messages.length) return;
      this.messages = kept;
      await this.storage.put('messages', this.messages);
      this.broadcast({ type: 'message_deleted', id });
      return;
    }

    if (msg.action === 'remove_reader') {
      const target = String(msg.user_id ?? '');
      if (!target || target === conn.identity.userId) return;
      // The owner's request has already written the removal to the group record; the
      // room drops them from here on rather than waiting for them to reconnect.
      this.blocked.add(target);
      this.broadcast({ type: 'reader_removed', user_id: target });
    }
  }

  async handleClose(conn) {
    this.readers.delete(conn.id);
    this.broadcastPresence();
  }

  broadcastPresence() {
    this.broadcast({ type: 'presence', readers: this.readers.size });
  }

  // Read per connection rather than cached — an invite, a removal or a closed group
  // takes effect straight away.
  async loadGroup() {
    try {
      return await this.client.asServiceRole.entities.BookGroup.get(this.instanceId);
    } catch {
      return null;
    }
  }

  // Messages are attributed to the platform-verified identity; the name is only a label.
  async displayName(userId, fallback) {
    if (this.names.has(userId)) return this.names.get(userId);

    try {
      const user = await this.client.asServiceRole.entities.User.get(userId);
      // Display name only — a reader's email address never goes out to the room.
      const resolved = String(user?.full_name || '').slice(0, 60);
      if (resolved) {
        this.names.set(userId, resolved);
        return resolved;
      }
    } catch {
      // fall through to the name this reader's own client sent
    }

    return String(fallback ?? '').replace(/[<>]/g, '').trim().slice(0, 60) || 'Reader';
  }
}