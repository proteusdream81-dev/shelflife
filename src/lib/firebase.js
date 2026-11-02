// Minimal Firebase Storage client for custom book covers.
// Covers must be publicly readable so a shared shelf still shows the reader's photo.
// Config is read from Vite env vars so nothing secret ships in the bundle beyond what
// Firebase already exposes in client apps.

import { initializeApp, getApps } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.storageBucket);

let storage = null;

function getFirebaseStorage() {
  if (!isConfigured()) return null;
  if (storage) return storage;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  storage = getStorage(app);
  return storage;
}

/**
 * Upload a prepared cover file to Firebase Storage and return a public download URL.
 * Path is covers/{timestamp}-{random}.jpg so names never collide.
 */
export async function uploadCoverToFirebase(file) {
  const store = getFirebaseStorage();
  if (!store) {
    throw new Error(
      "Cover storage is not configured yet. Add the VITE_FIREBASE_* keys and a public Storage rule for covers/."
    );
  }

  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `covers/${id}.jpg`;
  const storageRef = ref(store, path);

  await uploadBytes(storageRef, file, {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  });

  return getDownloadURL(storageRef);
}

export { isConfigured as isFirebaseConfigured };
