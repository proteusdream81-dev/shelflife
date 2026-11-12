import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { firebaseSocialGraphApi } from "@/lib/firebaseSocialGraphApi";
import { observeFirebaseUser, signOutFirebase } from "@/lib/firebaseAuth";
import FirebaseCommentsPanel from "@/components/tbr/FirebaseCommentsPanel";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";
const EMPTY_OVERVIEW = { following: [], followers: [], suggested: [], requests: [], requested: [], blocked: [] };

function Notice({ error, children }) {
  if (!error && !children) return null;
  return <div className={`rounded border p-3 text-sm ${error ? "border-red-300 text-red-700" : "border-green-300 text-green-700"}`} role={error ? "alert" : "status"}>{error || children}</div>;
}

function ReaderRow({ reader, children, onView }) {
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
    <div className="min-w-0">
      <p className="font-medium">{reader.name || "Reader"}</p>
      {reader.username && <p className="text-xs text-muted-foreground">@{reader.username}</p>}
      {Number.isInteger(reader.shared_shelves) && <p className="text-xs text-muted-foreground">{reader.shared_shelves} shared shelves</p>}
    </div>
    <div className="flex flex-wrap gap-2">{onView && <button className="rounded border px-3 py-1.5 text-xs" onClick={() => onView(reader)}>View library</button>}{children}</div>
  </article>;
}

export default function FirebaseReadingCirclePreview() {
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeReader, setActiveReader] = useState(null);
  const [readerLibrary, setReaderLibrary] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");

  useEffect(() => observeFirebaseUser((firebaseUser) => {
    setUser(firebaseUser?.emailVerified ? {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "",
    } : null);
  }), []);

  const loadOverview = useCallback(async () => {
    if (!user || !PREVIEW_ENABLED) return false;
    setLoading(true);
    setError("");
    try {
      const result = await firebaseSocialGraphApi.getOverview();
      setOverview(result);
      return true;
    } catch (err) {
      setError(err?.status === 409
        ? "This Firebase account has not completed the verified ShelfLife identity link and profile migration. No new profile will be created."
        : (err?.message || "Could not load the Reading Circle overview."));
      return false;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const runAction = async (key, action, successMessage) => {
    setSaving(key);
    setError("");
    setNotice("");
    try {
      await action();
      await loadOverview();
      setNotice(successMessage);
      return true;
    } catch (err) {
      setError(err?.status === 409
        ? "The relationship changed in another session. Refresh the Reading Circle and retry."
        : (err?.message || "The Reading Circle action failed."));
      return false;
    } finally {
      setSaving("");
    }
  };

  const search = async (event) => {
    event.preventDefault();
    const name = searchName.trim();
    if (name.length < 2) return;
    setLoading(true);
    setError("");
    setSearchResults([]);
    try {
      const result = await firebaseSocialGraphApi.searchReaders({ name });
      setSearchResults(result.readers || []);
      if (!(result.readers || []).length) setNotice("No matching visible readers found.");
    } catch (err) {
      setError(err?.message || "Reader search failed.");
    } finally {
      setLoading(false);
    }
  };

  const openLibrary = async (reader) => {
    setLoading(true);
    setError("");
    setNotice("");
    setActiveReader(reader);
    setReaderLibrary(null);
    try {
      const result = await firebaseSocialGraphApi.getReaderLibrary(reader.id);
      setReaderLibrary(result);
    } catch (err) {
      setActiveReader(null);
      setError(err?.status === 404
        ? "This reader has not shared a library with this account, or the relationship is blocked."
        : (err?.message || "Could not load this shared library."));
    } finally {
      setLoading(false);
    }
  };

  if (!PREVIEW_ENABLED) {
    return <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Firebase Reading Circle preview</h1>
      <p className="text-sm text-muted-foreground">This preview is disabled. Enable it only in the ShelfLife Vercel Preview environment after API validation.</p>
      <Link className="underline" to="/firebase-auth-preview">Open Firebase authentication preview</Link>
    </main>;
  }

  if (!user) {
    return <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Firebase Reading Circle preview</h1>
      <p className="text-sm text-muted-foreground">Sign in with a verified Firebase account that has a completed ShelfLife identity link and migrated profile.</p>
      <Link className="underline" to="/firebase-auth-preview">Sign in with Firebase</Link>
    </main>;
  }

  const actionButton = (key, label, action, success) => <button key={key} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50" disabled={Boolean(saving) || loading} onClick={() => runAction(key, action, success)}>{saving === key ? "Working…" : label}</button>;

  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Migration preview · authenticated Firebase API</p>
        <h1 className="text-2xl font-semibold">Reading Circle</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.displayName || user.email}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={loadOverview} disabled={loading}>Refresh</button>
        <button className="rounded border px-3 py-2 text-sm" onClick={() => signOutFirebase()}>Sign out</button>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Auth diagnostics</Link>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-library-preview">Library</Link>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-groups-preview">Groups</Link>
      </div>
    </header>

    <Notice error={error}>{notice}</Notice>
    <p className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">Preview-only Firebase social graph. Loading and searching are read-only. Follow, accept, remove, block and unblock buttons make explicit changes to the development project's relationship records only; no production account, import or identity-link writes are performed here.</p>

    <form onSubmit={search} className="flex flex-wrap gap-2 rounded-lg border p-4">
      <input className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" value={searchName} onChange={(event) => setSearchName(event.target.value)} minLength={2} maxLength={40} placeholder="Search reader names" aria-label="Search reader names" />
      <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" type="submit" disabled={loading || searchName.trim().length < 2}>Search</button>
    </form>
    {searchResults.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Search results</h2>{searchResults.map((reader) => <ReaderRow key={reader.id} reader={reader} onView={reader.state === "accepted" ? openLibrary : null}>{reader.state === "none" ? actionButton("search-follow:" + reader.id, "Follow", () => firebaseSocialGraphApi.followReader(reader.id), "Follow request sent.") : <span className="self-center text-xs text-muted-foreground">{reader.state === "pending" ? "Request pending" : "Connected"}</span>}</ReaderRow>)}</section>}

    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-2"><h2 className="font-semibold">Following ({overview.following.length})</h2>{overview.following.length === 0 && <p className="text-sm text-muted-foreground">No accepted following relationships.</p>}{overview.following.map((reader) => <ReaderRow key={reader.id} reader={reader} onView={openLibrary}>{actionButton("unfollow:" + reader.id, "Unfollow", () => firebaseSocialGraphApi.removeFollowRelationship(reader.relationshipId), "Following relationship removed.")}{actionButton("block-following:" + reader.id, "Block", () => firebaseSocialGraphApi.blockReader(reader.id), "Reader blocked.")}</ReaderRow>)}</section>
      <section className="space-y-2"><h2 className="font-semibold">Followers ({overview.followers.length})</h2>{overview.followers.length === 0 && <p className="text-sm text-muted-foreground">No accepted followers.</p>}{overview.followers.map((reader) => <ReaderRow key={reader.id} reader={reader} onView={reader.you_follow ? openLibrary : null}>{!reader.you_follow && actionButton("follow-follower:" + reader.id, "Follow back", () => firebaseSocialGraphApi.followReader(reader.id), "Follow request sent.")}{actionButton("remove-follower:" + reader.id, "Remove", () => firebaseSocialGraphApi.removeFollowRelationship(reader.relationshipId), "Follower removed.")}</ReaderRow>)}</section>
      <section className="space-y-2"><h2 className="font-semibold">Incoming requests ({overview.requests.length})</h2>{overview.requests.length === 0 && <p className="text-sm text-muted-foreground">No incoming requests.</p>}{overview.requests.map((reader) => <ReaderRow key={reader.id} reader={reader}>{actionButton("accept:" + reader.id, "Accept", () => firebaseSocialGraphApi.acceptFollowRequest(reader.relationshipId), "Follow request accepted.")}{actionButton("decline:" + reader.id, "Decline", () => firebaseSocialGraphApi.removeFollowRelationship(reader.relationshipId), "Follow request declined.")}</ReaderRow>)}</section>
      <section className="space-y-2"><h2 className="font-semibold">Sent requests ({overview.requested.length})</h2>{overview.requested.length === 0 && <p className="text-sm text-muted-foreground">No pending sent requests.</p>}{overview.requested.map((reader) => <ReaderRow key={reader.id} reader={reader}>{actionButton("cancel:" + reader.id, "Cancel", () => firebaseSocialGraphApi.removeFollowRelationship(reader.relationshipId), "Follow request cancelled.")}</ReaderRow>)}</section>
    </div>

    <section className="space-y-2"><h2 className="font-semibold">Suggested readers ({overview.suggested.length})</h2>{overview.suggested.length === 0 && <p className="text-sm text-muted-foreground">No visible readers with shared shelves were found.</p>}{overview.suggested.map((reader) => <ReaderRow key={reader.id} reader={reader}>{actionButton("suggest-follow:" + reader.id, "Follow", () => firebaseSocialGraphApi.followReader(reader.id), "Follow request sent.")}</ReaderRow>)}</section>

    <section className="space-y-2"><h2 className="font-semibold">Blocked readers ({overview.blocked.length})</h2>{overview.blocked.length === 0 && <p className="text-sm text-muted-foreground">No readers blocked by this account.</p>}{overview.blocked.map((reader) => <ReaderRow key={reader.id} reader={reader}>{actionButton("unblock:" + reader.id, "Unblock", () => firebaseSocialGraphApi.unblockReader(reader.id), "Reader unblocked.")}</ReaderRow>)}</section>

    {activeReader && <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Shared library</p><h2 className="text-lg font-semibold">{readerLibrary?.ownerName || activeReader.name}</h2></div><button className="rounded border px-3 py-2 text-sm" onClick={() => { setActiveReader(null); setReaderLibrary(null); }}>Close</button></div>
      {loading && !readerLibrary && <p className="text-sm text-muted-foreground">Loading shared library…</p>}
      {readerLibrary && <>
        {readerLibrary.shelves.map((shelf) => <article key={shelf.id} className="space-y-3 rounded border p-3"><div><h3 className="font-medium">{shelf.name || "Shared shelf"}</h3>{shelf.description && <p className="text-xs text-muted-foreground">{shelf.description}</p>}<ul className="mt-2 space-y-1 text-sm">{(shelf.books || []).map((book) => <li key={book.id}>{book.title || "Untitled book"}{book.author ? ` — ${book.author}` : ""}</li>)}</ul></div><details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Shelf discussion</summary><div className="pt-3"><FirebaseCommentsPanel targetKind="shelf" targetId={shelf.id} ownerUid={activeReader.id} /></div></details></article>)}
        {readerLibrary.shared_books.length > 0 && <article className="space-y-3 rounded border p-3"><h3 className="font-medium">Individually shared books</h3><ul className="space-y-3 text-sm">{readerLibrary.shared_books.map((book) => <li key={book.id} className="space-y-2"><p>{book.title || "Untitled book"}{book.author ? ` — ${book.author}` : ""}</p><details className="border-t pt-2"><summary className="cursor-pointer text-xs font-medium">Book discussion</summary><div className="pt-3"><FirebaseCommentsPanel targetKind="book" targetId={book.id} ownerUid={activeReader.id} /></div></details></li>)}</ul></article>}
        {readerLibrary.shelves.length === 0 && readerLibrary.shared_books.length === 0 && <p className="text-sm text-muted-foreground">This reader has not shared any books or shelves with this account.</p>}
        {readerLibrary.covers_hidden && <p className="text-xs text-muted-foreground">This reader has hidden book covers.</p>}
      </>}
    </section>}

    {loading && <p className="text-sm text-muted-foreground" role="status">Loading Firebase Reading Circle…</p>}
    <p className="text-xs text-muted-foreground">This preview covers the Firebase Reading Circle overview, name search, shared-reader library, authenticated shelf/book discussions and explicit relationship actions. The main ShelfLife Friends and ReaderLibrary pages remain on Base44 until the full app AuthContext and feature cutover gates pass.</p>
  </main>;
}
