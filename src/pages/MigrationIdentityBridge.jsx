import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const PREVIEW_URL = "https://shelflife-git-migration-firebase-profile-bridge-shelf-lufe.vercel.app";

export default function MigrationIdentityBridge() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startVerification = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await base44.functions.invoke("shelflifeIdentityBridge", {});
      const data = response?.data ?? response;
      if (typeof data?.bridgeCode !== "string" || !data.bridgeCode || data.bridgeCode.length > 4096) {
        throw new Error("The verification service did not return a valid one-time code.");
      }
      const destination = new URL("/firebase-link-preview", PREVIEW_URL);
      destination.hash = new URLSearchParams({ bridge: data.bridgeCode }).toString();
      window.location.replace(destination.toString());
    } catch (err) {
      setError(err?.message || "Could not start the secure verification hand-off.");
      setLoading(false);
    }
  };

  return <main className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
    <header>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">ShelfLife account verification</p>
      <h1 className="mt-2 text-2xl font-semibold">Verify your existing ShelfLife account</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This step confirms your current signed-in ShelfLife account, then opens the isolated Firebase migration preview. The hand-off code is signed, single-use and expires after five minutes.
      </p>
    </header>

    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Existing ShelfLife session</h2>
      {user ? <>
        <p className="text-sm text-muted-foreground">Signed in to the existing ShelfLife app.</p>
        <button
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={loading}
          onClick={startVerification}
        >
          {loading ? "Preparing secure hand-off…" : "Continue to Firebase verification"}
        </button>
      </> : <>
        <p className="text-sm text-muted-foreground">Sign in to the existing ShelfLife account first. The sign-in link returns to this verification page.</p>
        <a
          className="inline-block rounded border px-4 py-2 text-sm font-medium"
          href="/login?returnTo=%2Fmigration-identity-bridge"
        >
          Sign in to existing ShelfLife
        </a>
      </>}
      {error && <p className="rounded border border-red-300 p-3 text-sm text-red-700" role="alert">{error}</p>}
    </section>

    <p className="text-xs text-muted-foreground">
      No identity link is created here. The preview checks the Firebase session separately and records only a hashed one-time nonce in the development Firestore replay guard. User profiles, bookshelves and migration records are not changed.
    </p>
  </main>;
}
