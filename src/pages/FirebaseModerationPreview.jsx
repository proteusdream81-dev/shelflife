import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { observeFirebaseUser, signOutFirebase } from "@/lib/firebaseAuth";
import { firebaseCommentsApi } from "@/lib/firebaseCommentsApi";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";

function Notice({ error, children }) {
  if (!error && !children) return null;
  return <div className={`rounded border p-3 text-sm ${error ? "border-red-300 text-red-700" : "border-green-300 text-green-700"}`} role={error ? "alert" : "status"}>{error || children}</div>;
}

function explainError(error) {
  if (error?.status === 401) return "Sign in with a verified Firebase account to continue.";
  if (error?.status === 403) return "This account is not authorised as a ShelfLife moderator. Access is controlled by the server-side moderator allowlist.";
  if (error?.status === 409) return "This Firebase account has not completed its verified ShelfLife identity link and profile migration.";
  if (error?.status === 428) return "The report version is missing. Reload the queue before trying again.";
  return error?.message || "The moderation request failed.";
}

export default function FirebaseModerationPreview() {
  const [user, setUser] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => observeFirebaseUser((firebaseUser) => {
    setUser(firebaseUser?.emailVerified ? { uid: firebaseUser.uid, email: firebaseUser.email || "" } : null);
    setAccessChecked(true);
  }), []);

  const load = useCallback(async () => {
    if (!user || !PREVIEW_ENABLED) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await firebaseCommentsApi.listModerationReports({ limit: 50 });
      setReports(result.records || []);
    } catch (err) {
      setReports([]);
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (report, action) => {
    if (!report?.id || !report?.version || busy) return;
    const verb = action === "hide_comment" ? "hide this comment" : "dismiss this report";
    if (!window.confirm(`Are you sure you want to ${verb}? This action will be recorded in the moderation audit fields.`)) return;
    setBusy(report.id);
    setError("");
    setNotice("");
    try {
      await firebaseCommentsApi.resolveModerationReport(report.id, action, report.version);
      await load();
      setNotice(action === "hide_comment" ? "The reported comment was hidden and the report was actioned." : "The report was dismissed.");
    } catch (err) {
      if (err?.status === 409) {
        await load();
        setError("The report changed since it was loaded. The queue has been refreshed; review it again before taking action.");
      } else {
        setError(explainError(err));
      }
    } finally {
      setBusy("");
    }
  };

  if (!PREVIEW_ENABLED) return <main className="min-h-screen bg-background px-4 py-10 text-foreground"><section className="mx-auto max-w-2xl rounded-xl border p-6"><h1 className="text-xl font-semibold">Firebase moderation preview is disabled</h1><p className="mt-2 text-sm text-muted-foreground">The migration preview feature flag is not enabled for this deployment.</p></section></main>;

  return <main className="min-h-screen bg-background px-4 py-8 text-foreground"><div className="mx-auto max-w-3xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">ShelfLife · Firebase migration</p><h1 className="text-2xl font-semibold">Comment moderation</h1><p className="mt-1 text-sm text-muted-foreground">Preview-only moderator queue. All permissions and report actions are enforced by the server.</p></div><div className="flex flex-wrap gap-2"><Link className="rounded border px-3 py-2 text-sm" to="/firebase-reading-circle-preview">Reading Circle</Link><Link className="rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Auth diagnostics</Link></div></header>
    {!accessChecked ? <p role="status" className="text-sm text-muted-foreground">Checking Firebase sign-in…</p> : !user ? <section className="rounded-xl border p-5"><p className="text-sm">A verified Firebase session is required to access moderation.</p><Link className="mt-3 inline-block underline" to="/firebase-auth-preview">Open Firebase sign-in preview</Link></section> : <>
      <section className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Signed in</p><p className="text-xs text-muted-foreground">{user.email || "Verified Firebase account"}</p></div><button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => signOutFirebase()}>Sign out</button></div></section>
      <Notice error={error}>{notice}</Notice>
      <section className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Open reports</h2><p className="text-xs text-muted-foreground">{reports.length} report{reports.length === 1 ? "" : "s"} loaded · maximum 50</p></div><button type="button" className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "Refresh"}</button></div>
        {loading && <p role="status" className="py-5 text-center text-sm text-muted-foreground">Loading moderation queue…</p>}
        {!loading && !error && reports.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No open reports, or no reports are currently available.</p>}
        <div className="space-y-3">{reports.map((report) => <article key={report.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{report.targetKind === "book" ? "Book discussion" : "Shelf discussion"}</p><p className="text-xs text-muted-foreground">Reported {report.createdAt ? new Date(report.createdAt).toLocaleString() : "at an unknown time"}</p></div><span className="rounded bg-muted px-2 py-1 text-xs">Open</span></div>
          {report.excerpt && <blockquote className="border-l-2 pl-3 text-sm">{report.excerpt}</blockquote>}
          <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><div><dt className="inline font-medium">Reason: </dt><dd className="inline">{report.reason || "Not supplied"}</dd></div><div><dt className="inline font-medium">Report ID: </dt><dd className="inline break-all">{report.id}</dd></div></dl>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={() => resolve(report, "dismiss")} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy === report.id ? "Working…" : "Dismiss report"}</button><button type="button" disabled={!!busy} onClick={() => resolve(report, "hide_comment")} className="rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50">Hide comment</button></div>
        </article>)}</div>
      </section>
    </>}
    <p className="text-xs text-muted-foreground">This preview does not change Production, user profiles or the active Base44 moderation flow. A report is only resolved through the moderator-only API, with an If-Match version check and an audit record.</p>
  </div></main>;
}
