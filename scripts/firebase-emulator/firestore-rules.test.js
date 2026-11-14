import assert from "node:assert/strict";
import { before, test } from "node:test";

const projectId = "shelflife-emulator";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const documentId = "emulator-rules-deny-check";

let idToken;
let uid;

function documentUrl(path) {
  return `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

async function createTestIdentity() {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `firestore-emulator-${process.pid}@example.test`,
        password: "EmulatorOnly-Password-123!",
        returnSecureToken: true,
      }),
    },
  );

  assert.equal(response.status, 200, "Firebase Auth emulator must create a test-only user");
  const body = await response.json();
  assert.equal(typeof body.idToken, "string");
  assert.equal(typeof body.localId, "string");
  return { idToken: body.idToken, uid: body.localId };
}

before(async () => {
  assert.ok(authHost, "Run this test through Firebase Auth Emulator");
  assert.ok(firestoreHost, "Run this test through Firestore Emulator");
  ({ idToken, uid } = await createTestIdentity());
});

test("unauthenticated clients cannot read a user book document", async () => {
  const response = await fetch(documentUrl(`users/test-user/books/${documentId}`));
  assert.equal(response.status, 403);
});

test("authenticated clients cannot read a user book document directly", async () => {
  const response = await fetch(documentUrl(`users/${uid}/books/${documentId}`), {
    headers: { authorization: `Bearer ${idToken}` },
  });
  assert.equal(response.status, 403);
});

test("unauthenticated clients cannot create a user book document", async () => {
  const response = await fetch(
    documentUrl(`users/${uid}/books?documentId=${documentId}`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: { title: { stringValue: "Must be denied" } } }),
    },
  );
  assert.equal(response.status, 403);
});

test("authenticated clients cannot create a user book document directly", async () => {
  const response = await fetch(
    documentUrl(`users/${uid}/books?documentId=${documentId}`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fields: { title: { stringValue: "Must be denied" } } }),
    },
  );
  assert.equal(response.status, 403);
});
