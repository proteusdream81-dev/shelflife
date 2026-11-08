// Opt-in Firebase Authentication adapter for the migration.
// This module is intentionally not wired into AuthContext yet: the live app
// continues using Base44 until account migration and end-to-end parity are proven.

import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { getFirebaseApp } from "@/lib/firebase";

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error("Firebase is not configured. Check the VITE_FIREBASE_* web-app values.");
  }
  return getAuth(app);
}

export function observeFirebaseUser(callback) {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export async function registerWithEmail(email, password, displayName) {
  const auth = getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName?.trim()) {
    await updateProfile(credential.user, { displayName: displayName.trim().slice(0, 80) });
  }
  await sendEmailVerification(credential.user);
  return credential.user;
}

export async function signInWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  return credential.user;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(getFirebaseAuth(), provider);
  return credential.user;
}

export async function requestPasswordReset(email) {
  return sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

export async function signOutFirebase() {
  return signOut(getFirebaseAuth());
}

/** Returns a short-lived Firebase ID token for an Authorization: Bearer header. */
export async function getFirebaseIdToken(forceRefresh = false) {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("You must be signed in.");
  return user.getIdToken(forceRefresh);
}
