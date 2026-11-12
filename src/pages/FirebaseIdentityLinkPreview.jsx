import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appParams } from "@/lib/app-params";
import { getFirebaseIdToken, observeFirebaseUser } from "@/lib/firebaseAuth";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";

export default function FirebaseIdentityLinkPreview() {
  const { user: base44User } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [smokeTest, setSmokeTest] = useState(null);
  const [smokeTesting, setSmokeTesting] = useState(false);

  useEffect(() => observeFirebaseUser((user) => {
    setFirebaseUser(user?.emailVerified ? {
      email: user.email || "",
      displayName: user.displayName || "",
    } : null);
  }), []);

  const verifySessions = async () => {
    setChecking(true);
    setError("");
    setResult(null);
    try {
      if (!appParams.token) throw new Error("Your existing ShelfLife session is missing or expired. Sign in to Base44 again.");
      if (!firebaseUser) throw new Error("Sign in to your verified Firebase account first.");
      const firebaseToken = await getFirebaseIdToken();
      const response = await fetch("/api/auth/link", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${firebaseToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ base44Token: appParams.token, dryRun: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Identity verification failed (HTTP ${response.status}).`);
      if (payload.proofVerified !== true || payload.linked !== false || payload.dryRun !== true ||
          payload.verifiedIdentity?.proofMethod !== "dual-session" ||
          !payload.verifiedIdentity.firebaseUid || !payload.verifiedIdentity.base44UserId) {
        throw new Error("The identity verification service returned an unexpected result.");
      }
      setResult(payload);
    } catch (err) {
      setError(err?.message || "Could not verify both sessions.");
    } finally {
      setChecking(false);
    }
  };

  const runWifSmokeTest = async () => {
    setSmokeTesting(true);
    setSmokeTest(null);
    setError("");
    try {
      const firebaseToken = await getFirebaseIdToken();
      const response = await fetch("/api/migration/wif-smoke-test", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${firebaseToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true || payload.readBackVerified !== true || payload.cleanupVerified !== true) {
        throw new Error(payload?.error || `Firebase WIF smoke test failed (HTTP ${response.status}).`);
      }
      setSmokeTest(payload);
    } catch (err) {
      setError(err?.message || "Could not complete the Firebase WIF smoke test.");
    } finally {
      setSmokeTesting(false);
    }
  };

  if (!PREVIEW_ENABLED) return <main className="mx-auto max-w-2xl p-6">
    <h1 className="text-2xl font-semibold">Identity-link preview</h1>
    <p className="mt-3 text-sm text-muted-foreground">This dual-session verification page is available only in the migration Preview environment.</p>
  </main>;

  return <main className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
    <header>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Migration preview · proof only</p>
      <h1 className="text-2xl font-semibold">Verify both ShelfLife accounts</h1>
      <p className="mt-2 text-sm text-muted-foreground">This checks that you control the existing Base44 session and the verified Firebase session. It does not compare email addresses and does not create an identity link.</p>
    </header>

    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Existing ShelfLife account</h2>
        {base44User ? <p className="text-sm text-muted-foreground">{base44User.email || base44User.full_name || "Base44 session active"}</p>
          : <p className="text-sm text-muted-foreground">Not signed in to the existing app.</p>}
      </div>
      <div className="border-t pt-3">
        <h2 className="font-medium">Firebase account</h2>
        {firebaseUser ? <p className="text-sm text-muted-foreground">{firebaseUser.email || firebaseUser.displayName || "Verified Firebase session active"}</p>
          : <p className="text-sm text-muted-foreground">No verified Firebase session found in this browser.</p>}
      </div>
      {!base44User && <Link className="inline-block rounded border px-3 py-2 text-sm" to="/login?returnTo=%2Ffirebase-link-preview">Sign in to existing ShelfLife account</Link>}
      {!firebaseUser && <Link className="inline-block rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Sign in to Firebase</Link>}
      <button className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={checking || !base44User || !appParams.token || !firebaseUser} onClick={verifySessions}>
        {checking ? "Verifying both sessions…" : "Verify both sessions (no write)"}
      </button>
    </section>

    {error && <p className="rounded border border-red-300 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {result && <div className="space-y-2 rounded-lg border p-4" role="status">
      <p className="font-medium">Both sessions verified.</p>
      <p className="text-sm text-muted-foreground">No identity mapping was created. The dual-session proof passed, but Firestore identity-link writes were deliberately skipped. A separate reviewed migration step is required before any link is stored.</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Verified Firebase UID</dt><dd className="break-all font-mono">{result.verifiedIdentity.firebaseUid}</dd></div>
        <div><dt className="text-muted-foreground">Verified Base44 user ID</dt><dd className="break-all font-mono">{result.verifiedIdentity.base44UserId}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Proof method: {result.verifiedIdentity.proofMethod} · {result.verifiedIdentity.verifiedAt}</p>
      <p className="text-xs text-muted-foreground">The Base44 and Firebase session tokens were sent only to the same-origin verification endpoint and were not displayed or persisted by this page.</p>
    </div>}

    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Development Firebase workload identity</h2>
        <p className="text-sm text-muted-foreground">Creates one random temporary document in the dedicated development smoke-test collection, reads it back, and deletes it. No library, profile or migration records are touched.</p>
      </div>
      <button className="rounded border px-4 py-2 text-sm disabled:opacity-50" disabled={smokeTesting || !firebaseUser} onClick={runWifSmokeTest}>
        {smokeTesting ? "Testing workload identity…" : "Run isolated Firestore create/read/delete test"}
      </button>
      {smokeTest && <p className="text-sm" role="status">WIF verified for {smokeTest.projectId}. Create, read-back and cleanup all passed.</p>}
    </section>

    <p className="text-xs text-muted-foreground">Do not use email matching as identity proof. This preview requires simultaneous control of both live sessions. Session tokens are never displayed or persisted by this page. The verified IDs appear only after both sessions pass server-side verification.</p>
    <Link className="text-sm underline" to="/firebase-library-preview">Open read-only library preview</Link>
  </main>;
}
