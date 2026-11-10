import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { firebaseLibraryApi } from "@/lib/firebaseLibraryApi";
import { observeFirebaseUser, signOutFirebase } from "@/lib/firebaseAuth";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";

export default function FirebaseLibraryPreview() {
  const [user, setUser] = useState(null);
  const [books, setBooks] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [bookCursor, setBookCursor] = useState(null);
  const [shelfCursor, setShelfCursor] = useState(null);
  const [bookCount, setBookCount] = useState(0);
  const [shelfCount, setShelfCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => observeFirebaseUser((firebaseUser) => {
    setUser(firebaseUser?.emailVerified ? {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "",
    } : null);
  }), []);

  const loadFirstPage = useCallback(async () => {
    if (!user || !PREVIEW_ENABLED) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [bookPage, shelfPage] = await Promise.all([
        firebaseLibraryApi.listBooks({ limit: 50 }),
        firebaseLibraryApi.listShelves({ limit: 50 }),
      ]);
      setBooks(bookPage.records || []);
      setShelves(shelfPage.records || []);
      setBookCursor(bookPage.nextCursor || null);
      setShelfCursor(shelfPage.nextCursor || null);
      setBookCount(Number.isInteger(bookPage.count) ? bookPage.count : (bookPage.records || []).length);
      setShelfCount(Number.isInteger(shelfPage.count) ? shelfPage.count : (shelfPage.records || []).length);
      setNotice("Read-only Firebase library check completed.");
    } catch (err) {
      setError(err?.message || "Could not load the migrated library.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadMore = async (collection) => {
    const cursor = collection === "books" ? bookCursor : shelfCursor;
    if (!cursor || !user) return;
    setLoading(true);
    setError("");
    try {
      const page = collection === "books"
        ? await firebaseLibraryApi.listBooks({ limit: 50, cursor })
        : await firebaseLibraryApi.listShelves({ limit: 50, cursor });
      if (collection === "books") {
        setBooks((current) => [...current, ...(page.records || [])]);
        setBookCursor(page.nextCursor || null);
      } else {
        setShelves((current) => [...current, ...(page.records || [])]);
        setShelfCursor(page.nextCursor || null);
      }
    } catch (err) {
      setError(err?.message || "Could not load the next page.");
    } finally {
      setLoading(false);
    }
  };

  if (!PREVIEW_ENABLED) {
    return <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Firebase library preview</h1>
      <p className="mt-3 text-sm text-muted-foreground">This preview is disabled. Enable it only in the ShelfLife Vercel Preview environment after API validation.</p>
      <Link className="mt-4 inline-block underline" to="/firebase-auth-preview">Open Firebase authentication preview</Link>
    </main>;
  }

  if (!user) {
    return <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Firebase library preview</h1>
      <p className="mt-3 text-sm text-muted-foreground">Sign in with a verified Firebase account that has a completed ShelfLife identity link and migrated profile.</p>
      <Link className="mt-4 inline-block underline" to="/firebase-auth-preview">Sign in with Firebase</Link>
    </main>;
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview only · read-only</p>
        <h1 className="text-2xl font-semibold">Your ShelfLife library</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.displayName || user.email}</p>
      </div>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={loadFirstPage} disabled={loading}>Refresh</button>
        <button className="rounded border px-3 py-2 text-sm" onClick={() => signOutFirebase()}>Sign out</button>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Auth diagnostics</Link>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-groups-preview">Groups preview</Link>
      </div>
    </header>

    {(error || notice) && <div className={`rounded border p-3 text-sm ${error ? "border-red-300 text-red-700" : "border-green-300 text-green-700"}`} role={error ? "alert" : "status"}>{error || notice}</div>}
    {error.includes("migration is not complete") && <div className="rounded border p-3 text-sm text-muted-foreground">
      This account has not been linked to an existing ShelfLife identity and migrated profile. The preview will not create a blank profile or expose another reader's data. Complete the independently verified account-link and migration process first.
    </div>}

    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">Books</h2>
          <span className="text-xs text-muted-foreground">{books.length} loaded · {bookCount} on first page</span>
        </div>
        {books.length === 0 && !loading && <p className="text-sm text-muted-foreground">No migrated books were returned.</p>}
        <div className="space-y-2">
          {books.map((book) => <article key={book.id} className="rounded-lg border p-3">
            <p className="font-medium">{book.title || "Untitled book"}</p>
            <p className="text-xs text-muted-foreground">{book.author || "Author not recorded"}</p>
            <p className="mt-1 text-xs text-muted-foreground">ID: {book.id}</p>
          </article>)}
        </div>
        {bookCursor && <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={() => loadMore("books")}>Load more books</button>}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">Shelves</h2>
          <span className="text-xs text-muted-foreground">{shelves.length} loaded · {shelfCount} on first page</span>
        </div>
        {shelves.length === 0 && !loading && <p className="text-sm text-muted-foreground">No migrated shelves were returned.</p>}
        <div className="space-y-2">
          {shelves.map((shelf) => <article key={shelf.id} className="rounded-lg border p-3">
            <p className="font-medium">{shelf.name || "Untitled shelf"}</p>
            <p className="text-xs text-muted-foreground">{shelf.description || "No description"}</p>
            <p className="mt-1 text-xs text-muted-foreground">ID: {shelf.id}</p>
          </article>)}
        </div>
        {shelfCursor && <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={() => loadMore("shelves")}>Load more shelves</button>}
      </div>
    </section>
    {loading && <p className="text-sm text-muted-foreground" role="status">Loading Firebase library data…</p>}
    <p className="text-xs text-muted-foreground">This page performs authenticated reads only. It does not create profiles, write books or shelves, change sharing, or delete records. The main ShelfLife app remains on its existing provider.</p>
  </main>;
}
