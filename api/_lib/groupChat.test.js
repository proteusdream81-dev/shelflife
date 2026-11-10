import test from "node:test";
import assert from "node:assert/strict";
import {
  createGroupMessage,
  deleteGroupMessage,
  listGroupMessages,
  GroupChatInputError,
  GroupChatNotFoundError,
  GroupChatPermissionError,
} from "./groupChat.js";

function fakeDb({ ownerUid = "ownerA", members = { readerA: { status: "active" } }, removed = {}, messages = {} } = {}) {
  const state = {
    group: { ownerUid, name: "Test group", isPrivate: true },
    members: structuredClone(members),
    removed: structuredClone(removed),
    messages: structuredClone(messages),
  };
  const messageCollection = {
    doc(id) {
      return {
        async get() {
          const value = state.messages[id];
          return { exists: value !== undefined, id, updateTime: value?._version || "v1", data: () => value && structuredClone(value) };
        },
        async create(data) {
          if (state.messages[id]) { const error = new Error("exists"); error.code = "ALREADY_EXISTS"; throw error; }
          state.messages[id] = { ...structuredClone(data), _version: "v2" };
          return { updateTime: "v2" };
        },
        async delete({ lastUpdateTime } = {}) {
          if (!state.messages[id]) { const error = new Error("missing"); error.code = "NOT_FOUND"; throw error; }
          if (state.messages[id]._version !== lastUpdateTime) { const error = new Error("conflict"); error.code = "FAILED_PRECONDITION"; throw error; }
          delete state.messages[id];
        },
      };
    },
    limit(maximum) {
      const query = (cursor = null) => ({
        async get() {
          const docs = Object.entries(state.messages)
            .filter(([id]) => cursor === null || id > cursor)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, maximum)
            .map(([id, value]) => ({ id, data: () => structuredClone(value) }));
          return { docs };
        },
      });
      return { get: () => query().get(), startAfter: (cursor) => query(cursor) };
    },
  };
  const groupRef = {
    async get() {
      return { exists: state.group !== null, updateTime: "group-v1", data: () => state.group && structuredClone(state.group) };
    },
    collection(name) {
      if (name === "messages") return messageCollection;
      const bucket = name === "members" ? state.members : state.removed;
      return { doc(id) { return { async get() {
        const value = bucket[id];
        return { exists: value !== undefined, data: () => value && structuredClone(value) };
      } }; } };
    },
  };
  return {
    state,
    collection(name) {
      if (name !== "groups") throw new Error("Unexpected collection");
      return { doc(id) { return id === "group-1" ? groupRef : { get: async () => ({ exists: false }) }; } };
    },
  };
}

test("lists messages only for active members with an explicit safe projection", async () => {
  const db = fakeDb({ messages: {
    "message-1": { authorUid: "readerA", displayName: "Reader A", body: "Hello", createdAt: "2026-11-10T00:00:00Z", email: "private@example.test" },
  } });
  const result = await listGroupMessages({ db, groupId: "group-1", uid: "readerA" });
  assert.deepEqual(result.records, [{
    id: "message-1", authorUid: "readerA", displayName: "Reader A", body: "Hello", createdAt: "2026-11-10T00:00:00Z",
  }]);
  assert.equal(JSON.stringify(result).includes("private@example.test"), false);
});

test("allows the owner but denies nonmembers and removed members", async () => {
  const db = fakeDb({ members: {}, removed: { readerB: { removedAt: "2026-11-10T00:00:00Z" } } });
  await listGroupMessages({ db, groupId: "group-1", uid: "ownerA" });
  await assert.rejects(listGroupMessages({ db, groupId: "group-1", uid: "readerB" }), GroupChatPermissionError);
  await assert.rejects(listGroupMessages({ db, groupId: "group-1", uid: "readerC" }), GroupChatPermissionError);
});

test("creates messages using the authenticated author and a bounded normalized body", async () => {
  const db = fakeDb();
  const result = await createGroupMessage({
    db, groupId: "group-1", uid: "readerA", displayName: "Reader A",
    body: "  Hello\r\nShelfLife  ", createId: () => "message-new",
    now: () => "2026-11-10T01:00:00.000Z",
  });
  assert.equal(result.authorUid, "readerA");
  assert.equal(result.body, "Hello\nShelfLife");
  assert.equal(result.id, "message-new");
  assert.equal(db.state.messages["message-new"].schemaVersion, 1);
});

test("rejects blank, oversized and control-character messages", async () => {
  const db = fakeDb();
  await assert.rejects(createGroupMessage({ db, groupId: "group-1", uid: "readerA", body: "  " }), GroupChatInputError);
  await assert.rejects(createGroupMessage({ db, groupId: "group-1", uid: "readerA", body: "x".repeat(1001) }), GroupChatInputError);
  await assert.rejects(createGroupMessage({ db, groupId: "group-1", uid: "readerA", body: "bad\u0001text" }), GroupChatInputError);
});

test("only the group owner can delete a message and deletion is version guarded", async () => {
  const db = fakeDb({ messages: { "message-1": { authorUid: "readerA", body: "Hello", _version: "v1" } } });
  await assert.rejects(deleteGroupMessage({ db, groupId: "group-1", uid: "readerA", messageId: "message-1" }), GroupChatPermissionError);
  assert.deepEqual(await deleteGroupMessage({ db, groupId: "group-1", uid: "ownerA", messageId: "message-1" }), {
    deleted: true, id: "message-1",
  });
  assert.equal(db.state.messages["message-1"], undefined);
});

test("rejects missing groups and invalid message cursors", async () => {
  const db = fakeDb();
  await assert.rejects(listGroupMessages({ db, groupId: "../bad", uid: "readerA" }), GroupChatInputError);
  await assert.rejects(listGroupMessages({ db, groupId: "missing", uid: "readerA" }), GroupChatNotFoundError);
  await assert.rejects(listGroupMessages({ db, groupId: "group-1", uid: "readerA", cursor: "../bad" }), GroupChatInputError);
});


test("closed groups no longer expose their chat history", async () => {
  const db = fakeDb();
  db.state.group.status = "closed";
  await assert.rejects(listGroupMessages({ db, groupId: "group-1", uid: "readerA" }), GroupChatNotFoundError);
});
