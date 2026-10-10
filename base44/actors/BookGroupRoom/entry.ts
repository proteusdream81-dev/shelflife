import { Actor } from 'base44:runtime/actors';

// One room per reading group: the group record id IS this room's instance id.
const MAX_READERS = 40;
const HISTORY_LIMIT = 120;
const KEEP_MESSAGES = 300;
const MAX_BODY = 1000;

export default class BookGroupRoom extends Actor {
  readers = new Map(); // conn.id -> {} (presence only, no seats)
  messages = [];
  names = new Map(); // userId -> display name
  seq = 0;

  // Runs on ANY wake, including hibernation where sockets stay attached.
  async handleStart() {
    const saved = await this.storage.get('messages');
    if (Array.isArray(saved)) this.messages = saved;
    this.readers = new Map(this.getConnections().map((conn) => [conn.id, {}]));
  }

  async handleConnect(conn) {
    // A group's chat is for signed-in readers: the room id is public, so nothing —
    // not even history — goes out before the platform-verified identity checks out.
    if (conn.identity?.type !== 'authenticated') {
      conn.reject(4003, 'Sign in to join this group');
      return;
    }
    // A private group admits only its owner and the readers the owner invited.
    if (!(await this.mayJoinGroup(conn.identity.userId))) {
      conn.reject(4004, 'This private group is invite only');
      return;
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
    if (msg.type !== 'message') return;
    if (!this.readers.has(conn.id)) return;

    const identity = conn.identity;
    if (!identity || identity.type !== 'authenticated') {
      conn.send({ type: 'error', text: 'Sign in to post in this group.' });
      return;
    }

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

  async handleClose(conn) {
    this.readers.delete(conn.id);
    this.broadcastPresence();
  }

  broadcastPresence() {
    this.broadcast({ type: 'presence', readers: this.readers.size });
  }

  // Any signed-in reader may sit in a public group's room; a private one is only for its
  // owner and the readers they invited. The group record is the truth for that, so it is
  // read per connection rather than cached — an invite takes effect straight away.
  async mayJoinGroup(userId) {
    try {
      const group = await this.client.asServiceRole.entities.BookGroup.get(this.instanceId);
      if (!group) return false;
      if (!group.is_private) return true;
      const invited = Array.isArray(group.member_ids) ? group.member_ids.map(String) : [];
      return group.created_by_id === userId || invited.includes(userId);
    } catch {
      return false;
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