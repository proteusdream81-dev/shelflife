// Opt-in Firebase Authentication adapter for the migration.
// Deliberately not wired into the live AuthContext or login screens yet.
// Base44 remains the active identity provider until user/profile mapping,
// backend authorization, and end-to-end feature parity are proven.

import {
  applyActionCode,
  browserLocalPersistence,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  setPersistence,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";
import { getFirebaseApp } from "@/lib/firebase";
import { getAccessToken } from "@base44/sdk";
import { createShelfLifeBearerTokenProvider } from "./shelfLifeBearerToken.js";

function previewContinueUrl(action) {
  const url = new URL("/firebase-auth-preview", window.location.origin);
  url.searchParams.set("firebaseAction", action);
  return url.toString();
}

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
  await sendEmailVerification(credential.user, {
    url: previewContinueUrl("verifyComplete"),
    handleCodeInApp: false,
  });
  const createdUser = credential.user;
  // Do not leave an unverified account signed in, even in the preview flow.
  await signOut(auth);
  return createdUser;
}

export async function signInWithEmail(email, password) {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await credential.user.reload();
  if (!credential.user.emailVerified) {
    await signOut(auth);
    throw new Error("Please verify your email using the link we sent before signing in.");
  }
  return credential.user;
}

export async function resendEmailVerification() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in again to request a verification email.");
  if (user.emailVerified) return;
  await sendEmailVerification(user, {
    url: previewContinueUrl("verifyComplete"),
    handleCodeInApp: false,
  });
}

export async function applyEmailVerificationCode(actionCode) {
  if (!actionCode) throw new Error("The verification link is incomplete or invalid.");
  await applyActionCode(getFirebaseAuth(), actionCode);
}

export async function signInWithGoogle() {
  const auth = getFirebaseAuth();
  // Keep the Preview session available after the popup closes or the page reloads.
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  // Redirect is more reliable than popups on mobile browsers, where the
  // Firebase handler can open in a separate tab and fail to return to its opener.
  await signInWithRedirect(auth, provider);
}

export async function getGoogleRedirectResult() {
  return getRedirectResult(getFirebaseAuth());
}

export async function requestPasswordReset(email) {
  return sendPasswordResetEmail(getFirebaseAuth(), email.trim(), {
    url: previewContinueUrl("resetComplete"),
    // Use Firebase's standard web action handler unless a custom handler is approved.
    // The preview URL is the continuation destination after the reset completes.
    handleCodeInApp: false,
  });
}

export async function completePasswordReset(actionCode, newPassword) {
  if (!actionCode) throw new Error("The password reset link is incomplete or invalid.");
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("Choose a password with at least 8 characters.");
  }
  return confirmPasswordReset(getFirebaseAuth(), actionCode, newPassword);
}

export async function signOutFirebase() {
  return signOut(getFirebaseAuth());
}

const getShelfLifeBearerToken = createShelfLifeBearerTokenProvider({
  getFirebaseToken: async (forceRefresh = false) => {
    let auth;
    try {
      auth = getFirebaseAuth();
    } catch {
      return null;
    }
    const user = auth.currentUser;
    return user ? user.getIdToken(forceRefresh) : null;
  },
  getBase44Token: () => {
    try {
      return getAccessToken() || null;
    } catch {
      return null;
    }
  },
  isCompatibilityEnabled: () => import.meta.env.VITE_BASE44_COMPAT_AUTH === "true",
});

/** Returns a Firebase ID token, or the Preview-only Base44 session during migration. */
export async function getFirebaseIdToken(forceRefresh = false) {
  return getShelfLifeBearerToken(forceRefresh);
}