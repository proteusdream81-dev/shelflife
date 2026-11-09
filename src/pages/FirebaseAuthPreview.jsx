import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import {
  applyEmailVerificationCode,
  completePasswordReset,
  registerWithEmail,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  getFirebaseIdToken,
} from "@/lib/firebaseAuth";

// Isolated Preview-only Firebase auth exercise. It deliberately does not grant
// access to ShelfLife data or replace the Base44 AuthContext.
export default function FirebaseAuthPreview() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [diagnosticRows, setDiagnosticRows] = useState([]);
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const action = searchParams.get("mode");
  const actionCode = searchParams.get("oobCode");

  useEffect(() => {
    if (action === "verifyEmail" && actionCode) {
      setLoading(true);
      applyEmailVerificationCode(actionCode)
        .then(() => {
          setMode("login");
          setMessage("Email verified. You can now sign in.");
        })
        .catch((err) => setError(err.message || "This verification link is invalid or expired."))
        .finally(() => setLoading(false));
    } else if (action === "resetPassword" && actionCode) {
      setMode("reset");
    } else if (action) {
      setError("This email action link is incomplete or unsupported. Request a fresh link.");
    }
  }, [action, actionCode]);

  const run = async (callback) => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await callback();
    } catch (err) {
      setError(err?.message || "Authentication could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = (event) => {
    event.preventDefault();
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    run(async () => {
      const created = await registerWithEmail(email, password, displayName);
      setEmail(created.email || email);
      setPassword("");
      setConfirmPassword("");
      setMessage("Account created. Check your inbox for the verification link, then return here to sign in.");
    });
  };

  const handleLogin = (event) => {
    event.preventDefault();
    run(async () => {
      const signedIn = await signInWithEmail(email, password);
      setUser({ uid: signedIn.uid, email: signedIn.email, displayName: signedIn.displayName });
      setMessage("Firebase authentication succeeded. ShelfLife data access is intentionally not enabled in this preview.");
    });
  };

  const handleGoogle = () => run(async () => {
    const signedIn = await signInWithGoogle();
    setUser({ uid: signedIn.uid, email: signedIn.email, displayName: signedIn.displayName });
    setMessage("Google authentication succeeded. ShelfLife data access is intentionally not enabled in this preview.");
  });

  const runOwnedDataDiagnostic = async () => {
    setDiagnosticRunning(true);
    setDiagnosticRows([]);
    setError("");
    try {
      const idToken = await getFirebaseIdToken();
      const entities = ["Book", "Shelf", "BookGroup", "Follow", "Block", "ReleaseReminder"];
      const rows = [];
      for (const entity of entities) {
        try {
          const response = await fetch(`/api/data/owned?entity=${encodeURIComponent(entity)}&limit=100`, {
            method: "GET",
            cache: "no-store",
            headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
          });
          const payload = await response.json().catch(() => ({}));
          rows.push({ entity, status: response.status, count: response.ok && Number.isInteger(payload.count) ? payload.count : null, result: response.ok ? "PASS" : (payload.error || "Request failed") });
        } catch {
          rows.push({ entity, status: "—", count: null, result: "Network request failed" });
        }
        setDiagnosticRows([...rows]);
      }
    } catch (diagnosticError) {
      setError(diagnosticError?.message || "Could not obtain a signed-in Firebase session.");
    } finally {
      setDiagnosticRunning(false);
    }
  };

  const handleForgot = (event) => {
    event.preventDefault();
    run(async () => {
      await requestPasswordReset(email);
      setMessage("If the address is registered, a password-reset link will arrive shortly.");
    });
  };

  const handleReset = (event) => {
    event.preventDefault();
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    run(async () => {
      await completePasswordReset(actionCode, password);
      setPassword("");
      setConfirmPassword("");
      setMode("login");
      setMessage("Password updated. Sign in with your new password.");
      window.history.replaceState({}, "", "/firebase-auth-preview");
    });
  };

  if (user) {
    return (
      <AuthLayout title="Firebase sign-in successful" subtitle="Preview authentication check">
        <div className="rounded-lg border p-4 space-y-2">
          <CheckCircle2 className="w-6 h-6 text-green-600" />
          <p className="font-medium">{user.displayName || "Signed in"}</p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground break-all">Firebase UID: {user.uid}</p>
          <div className="mt-4 border-t pt-4 space-y-3">
            <div><p className="font-medium text-sm">Read-only Firestore ownership check</p><p className="text-xs text-muted-foreground">Checks the six approved collections using this signed-in session. Only status and record counts are displayed; record contents and ID tokens are never shown.</p></div>
            <Button className="w-full" onClick={runOwnedDataDiagnostic} disabled={diagnosticRunning}>{diagnosticRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Run six-collection check</Button>
            {diagnosticRows.length > 0 && <div className="space-y-2" role="status" aria-live="polite">{diagnosticRows.map(row => <div key={row.entity} className="flex items-center justify-between gap-3 rounded border p-2 text-xs"><span className="font-medium">{row.entity}</span><span className="text-muted-foreground">{row.status}</span><span>{row.count === null ? row.result : `${row.count} records · ${row.result}`}</span></div>)}</div>}
            <p className="text-xs text-muted-foreground">A 409 means the signed-in Firebase account has no verified identity link. A 401/403 indicates session or verification requirements. This does not test isolation against a second account.</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">This test page does not connect this identity to an existing ShelfLife profile or expose personal library data.</p>
        <Button className="w-full mt-4" variant="outline" onClick={() => run(async () => { await signOutFirebase(); setUser(null); setMessage("Signed out of the Firebase test account."); })}>Sign out of test account</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={mode === "register" ? "Create preview account" : mode === "forgot" ? "Reset password" : mode === "reset" ? "Choose a new password" : "Firebase auth preview"}
      subtitle="Isolated test only — your existing ShelfLife sign-in remains unchanged"
      footer={<Link to="/login" className="text-primary font-medium hover:underline">Back to current ShelfLife login</Link>}
    >
      <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        Preview-only authentication. This does not migrate an existing account or grant access to ShelfLife books, shelves, groups, or settings.
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
      {message && <div role="status" className="mb-4 rounded-lg bg-muted p-3 text-sm">{message}</div>}

      {mode === "login" && <>
        <Button variant="outline" className="mb-5 h-12 w-full" onClick={handleGoogle} disabled={loading}>
          <GoogleIcon className="mr-2 h-5 w-5" />Continue with Google
        </Button>
        <div className="mb-5 text-center text-xs uppercase text-muted-foreground">or email and password</div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="firebase-email">Email</Label><Input id="firebase-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="firebase-password">Password</Label><Input id="firebase-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          <Button className="h-12 w-full" type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}Sign in</Button>
        </form>
        <div className="mt-5 flex justify-between text-sm"><button className="text-primary hover:underline" onClick={() => {setMode("register");setError("");setMessage("");}}>Create test account</button><button className="text-primary hover:underline" onClick={() => {setMode("forgot");setError("");setMessage("");}}>Forgot password?</button></div>
      </>}

      {mode === "register" && <form onSubmit={handleRegister} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="firebase-name">Display name</Label><Input id="firebase-name" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="firebase-email">Email</Label><Input id="firebase-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="firebase-password">Password (8+ characters)</Label><Input id="firebase-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="firebase-confirm">Confirm password</Label><Input id="firebase-confirm" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div>
        <Button className="h-12 w-full" type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Create test account</Button>
        <button type="button" className="w-full text-sm text-primary hover:underline" onClick={() => setMode("login")}>Back to sign in</button>
      </form>}

      {mode === "forgot" && <form onSubmit={handleForgot} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="firebase-email">Email address</Label><Input id="firebase-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <Button className="h-12 w-full" type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send reset link</Button>
        <button type="button" className="w-full text-sm text-primary hover:underline" onClick={() => setMode("login")}>Back to sign in</button>
      </form>}

      {mode === "reset" && <form onSubmit={handleReset} className="space-y-4">
        {!actionCode && <p className="text-sm text-destructive">The reset link is missing its action code. Request a new link.</p>}
        <div className="space-y-2"><Label htmlFor="firebase-password">New password</Label><Input id="firebase-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="firebase-confirm">Confirm new password</Label><Input id="firebase-confirm" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div>
        <Button className="h-12 w-full" type="submit" disabled={loading || !actionCode}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}Update password</Button>
      </form>}
    </AuthLayout>
  );
}
