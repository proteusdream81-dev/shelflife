import test from "node:test";
import assert from "node:assert/strict";
import {
  createGroupMessage, deleteGroupMessage, listGroupMessages,
  GroupChatPermissionError, GroupChatInputError,
} from "./groupChat.js";

function fakeDb({ ownerUid = "owner", members = {}, removed = {}, messages = {} } = {}) {
  const state = { messages: structuredClone(messages), deleted: [] };
  const groupRef = {
    async get() { return { exists: true, data: () => ({ ownerUid, status: "active" }) }; },
    collection(name) {
      if (name === "members" || name === "removed") return {
        doc(uid) { const source = name === "members" ? members : removed; return {
          async get() { return { exists: Object.hasOwn(source, uid), data: () => source[uid] }; },
        }; },
      };
      if (name === "messages") return {
        doc(id) { return {
          async create(data) {
            if (state.messages[id]) { const e = new Error("exists"); e.code = "ALREADY_EXISTS"; throw e; }
            state.messages[id] = structuredClone(data);
            return { updateTime: "version-1" };
          },
          async get() {
            const data = state.messages[id];
            return { exists: Boolean(data), updateTime: data ? "version-1" : null, data: () => data };
          },
          async delete(options) {
            assert.equal(options.lastUpdateTime, "version-1");
            delete state.messages[id]; state.deleted.push(id);
          },
        }; },
        limit(maximum) {
          const query = (cursor = null) => ({
            async get() {
              const docs = Object.entries(state.messages).sort(([a], [b]) => a.localeCompare(b))
                .filter(([id]) => cursor === null || id > cursor).slice(0, maximum)
                .map(([id, data]) => ({ id, data: () => structuredClone(data) }));
              return { docs };
            },
          });
          return { get: () => query().get(), startAfter: (cursor) => query(cursor) };
        },
      };
      throw new Error("Unexpected subcollection " + name);
    },
  };
  return { collection(name) { assert.equal(name, "groups"); return { doc(id) { assert.equal(id, "groupA"); return groupRef; } }; }, state };
}

test("active group member can read only the safe message projection with cursor paging", async () => {
  const db = fakeDb({
    members: { readerA: { status: "active" } },
    messages: {
      a: { authorUid: "readerB", displayName: "Reader B", body: "hello", createdAt: "2026-11-10T00:00:00Z", email: "private@example.test" },
      b: { authorUid: "readerC", displayName: "Reader C", body: "next", createdAt: "2026-11-10T00:01:00Z" },
    },
  });
  const page = await listGroupMessages({ db, groupId: "groupA", uid: "readerA", limit: 1 });
  assert.equal(page.records[0].body, "hello");
  assert.equal(page.nextCursor, "a");
  assert.equal(JSON.stringify(page).includes("private@example.test"), false);
  const next = await listGroupMessages({ db, groupId: "groupA", uid: "readerA", limit: 1, cursor: page.nextCursor });
  assert.equal(next.records[0].id, "b");
});

test("removed reader cannot read even if a member record remains active", async () => {
  const db = fakeDb({ members: { readerA: { status: "active" } }, removed: { readerA: { reason: "removed" } } });
  await assert.rejects(listGroupMessages({ db, groupId: "groupA", uid: "readerA" }), GroupChatPermissionError);
});

test("non-member cannot post and message body is normalized and bounded", async () => {
  const db = fakeDb();
  await assert.rejects(createGroupMessage({ db, groupId: "groupA", uid: "readerA", body: "hello" }), GroupChatPermissionError);
  const memberDb = fakeDb({ members: { readerA: { status: "active" } } });
  const result = await createGroupMessage({
    db: memberDb, groupId: "groupA", uid: "readerA", displayName: " Reader A ",
    body: "  hello\r\nworld  ", createId: () => "message-1", now: () => "2026-11-10T00:00:00Z",
  });
  assert.equal(result.body, "hello\nworld");
  assert.equal(result.displayName, "Reader A");
  assert.equal(result.version, "version-1");
  await assert.rejects(createGroupMessage({
    db: memberDb, groupId: "groupA", uid: "readerA", body: "x".repeat(1001),
  }), GroupChatInputError);
});

test("only the group owner can delete messages with optimistic version check", async () => {
  const db = fakeDb({ members: { readerA: { status: "active" } }, messages: { message1: { body: "hello", authorUid: "readerA" } } });
  await assert.rejects(deleteGroupMessage({ db, groupId: "groupA", uid: "readerA", messageId: "message1" }), GroupChatPermissionError);
  const ownerDb = fakeDb({ messages: { message1: { body: "hello", authorUid: "readerA" } } });
  assert.deepEqual(await deleteGroupMessage({ db: ownerDb, groupId: "groupA", uid: "owner", messageId: "message1" }), {
    deleted: true, id: "message1",
  });
  assert.deepEqual(ownerDb.state.deleted, ["message1"]);
});
