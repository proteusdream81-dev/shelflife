import test from "node:test";
import assert from "node:assert/strict";
import {
  IdentityNotLinkedError,
  ProfileNotMigratedError,
  resolveShelfLifeProfile,
} from "./profile.js";

function fakeDb({ link = null, profile = null } = {}) {
  const calls = [];
  return {
    calls,
    collection(name) {
      calls.push(["collection", name]);
      return {
        doc(id) {
          calls.push(["doc", id]);
          return {
            async get() {
              const value = name === "identityLinks" ? link : profile;
              return { exists: value !== null, data: () => value };
            },
          };
        },
      };
    },
  };
}

const firebaseUser = {
  uid: "firebase-uid-1",
  email: "reader@example.test",
  emailVerified: true,
  displayName: "Reader",
};

test("returns an allowlisted profile for a verified identity link", async () => {
  const db = fakeDb({
    link: { status: "verified", base44UserId: "legacy-user-1" },
    profile: {
      displayName: "Reader One",
      username: "readerone",
      profileHidden: true,
      hideCovers: true,
      showContentWarnings: false,
      storefront: "reader-store",
      foundingTesterOptedIn: true,
      testerPromptDismissed: true,
      schemaVersion: 1,
      migration: { sourceEntity: "User", sourceId: "legacy-user-1" },
      role: "admin",
      email: "private@example.test",
      unknown_private_field: "must not escape",
    },
  });

  const result = await resolveShelfLifeProfile({ db, firebaseUser });
  assert.deepEqual(result, {
    uid: "firebase-uid-1",
    email: "reader@example.test",
    emailVerified: true,
    displayName: "Reader",
    profile: {
      displayName: "Reader One",
      username: "readerone",
      profileHidden: true,
      hideCovers: true,
      showContentWarnings: false,
      storefront: "reader-store",
      foundingTesterOptedIn: true,
      testerPromptDismissed: true,
    },
  });
  assert.equal(JSON.stringify(result).includes("legacy-user-1"), false);
  assert.equal(JSON.stringify(result).includes("must not escape"), false);
  assert.equal(JSON.stringify(result).includes('"role"'), false);
});

test("does not infer a link from email or accept pending links", async () => {
  for (const link of [
    null,
    { email: "reader@example.test", base44UserId: "legacy-user-1" },
    { status: "pending", base44UserId: "legacy-user-1" },
  ]) {
    await assert.rejects(
      resolveShelfLifeProfile({ db: fakeDb({ link, profile: {} }), firebaseUser }),
      IdentityNotLinkedError,
    );
  }
});

test("does not create a blank profile for a linked legacy account", async () => {
  await assert.rejects(
    resolveShelfLifeProfile({
      db: fakeDb({ link: { status: "verified", base44UserId: "legacy-user-1" } }),
      firebaseUser,
    }),
    ProfileNotMigratedError,
  );
});

test("rejects malformed Firebase UIDs before database access", async () => {
  const db = fakeDb({ link: { status: "verified", base44UserId: "legacy-user-1" }, profile: {} });
  await assert.rejects(
    resolveShelfLifeProfile({ db, firebaseUser: { ...firebaseUser, uid: "../other" } }),
    TypeError,
  );
  assert.deepEqual(db.calls, []);
});
