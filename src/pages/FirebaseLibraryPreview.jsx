import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { firebaseLibraryApi } from "@/lib/firebaseLibraryApi";
import { observeFirebaseUser, signOutFirebase } from "@/lib/firebaseAuth";

const PREVIEW_ENABLED = import.meta.env?.VITE_FIREBASE_MIGRATION_PREVIEW_ENABLED === "true";
const EMPTY_BOOK = { title: "", author: "", status: "to_read", shelfId: "" };
const EMPTY_SHELF = { name: "", description: "", is_private: false };

function Notice({ error, children }) {
  if (!error && !children) return null;
  return <div className={error ? "rounded border border-red-300 p-3 text-sm text-red-700" : "rounded border p-3 text-sm"} role={error ? "alert" : "status"}>{error || children}</div>;
}

export default function FirebaseLibraryPreview() {
  const [user, setUser] = useState(null);
  const [books, setBooks] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [bookCursor, setBookCursor] = useState(null);
  const [shelfCursor, setShelfCursor] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [bookForm, setBookForm] = useState(EMPTY_BOOK);
  const [shelfForm, setShelfForm] = useState(EMPTY_SHELF);
  const [editingBook, setEditingBook] = useState(null);
  const [editingShelf, setEditingShelf] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

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
      setNotice("Firebase Books and Shelves loaded.");
    } catch (err) {
      setError(err?.message || "Could not load the migrated library.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadMore = async (collection) => {
    const cursor = collection === "books" ? bookCursor : shelfCursor;
    if (!cursor || !user || loading) return;
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

  const runMutation = async (key, action, successMessage) => {
    setSaving(key);
    setError("");
    setNotice("");
    try {
      await action();
      await loadFirstPage();
      setNotice(successMessage);
      return true;
    } catch (err) {
      setError(err?.status === 409
        ? "This record changed in another session. Reloaded data is required before retrying."
        : (err?.message || "The change could not be saved."));
      return false;
    } finally {
      setSaving("");
    }
  };

  const createBook = async (event) => {
    event.preventDefault();
    const title = bookForm.title.trim();
    if (!title) return;
    const shelfIds = bookForm.shelfId ? [bookForm.shelfId] : [];
    const ok = await runMutation("create-book", () => firebaseLibraryApi.createBook({
      title, author: bookForm.author.trim(), status: bookForm.status, shelfIds,
    }), "Book added.");
    if (ok) setBookForm(EMPTY_BOOK);
  };

  const createShelf = async (event) => {
    event.preventDefault();
    const name = shelfForm.name.trim();
    if (!name) return;
    const ok = await runMutation("create-shelf", () => firebaseLibraryApi.createShelf({
      name, description: shelfForm.description.trim(), is_private: shelfForm.is_private,
    }), "Shelf created.");
    if (ok) setShelfForm(EMPTY_SHELF);
  };

  const saveBook = async (event) => {
    event.preventDefault();
    if (!editingBook) return;
    const { id, version } = editingBook;
    const shelfIds = editingBook.shelfId ? [editingBook.shelfId] : [];
    const ok = await runMutation("book:" + id, () => firebaseLibraryApi.updateBook(
      { id, version },
      { title: editingBook.title.trim(), author: editingBook.author.trim(), status: editingBook.status, shelfIds },
    ), "Book updated.");
    if (ok) setEditingBook(null);
  };

  const saveShelf = async (event) => {
    event.preventDefault();
    if (!editingShelf) return;
    const { id, version } = editingShelf;
    const ok = await runMutation("shelf:" + id, () => firebaseLibraryApi.updateShelf(
      { id, version },
      { name: editingShelf.name.trim(), description: editingShelf.description.trim(), is_private: editingShelf.is_private },
    ), "Shelf updated.");
    if (ok) setEditingShelf(null);
  };

  const removeRecord = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runMutation("delete:" + target.id, () => target.kind === "book"
      ? firebaseLibraryApi.deleteBook(target.record)
      : firebaseLibraryApi.deleteShelf(target.record),
    target.kind === "book" ? "Book removed." : "Shelf removed.");
    setDeleteTarget(null);
  };

  if (!PREVIEW_ENABLED) {
    return <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Firebase library workspace</h1>
      <p className="text-sm text-muted-foreground">This preview is disabled. Enable it only in the ShelfLife Vercel Preview environment after API validation.</p>
      <Link className="underline" to="/firebase-auth-preview">Open Firebase authentication preview</Link>
    </main>;
  }

  if (!user) {
    return <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Firebase library workspace</h1>
      <p className="text-sm text-muted-foreground">Sign in with a verified Firebase account that has a completed ShelfLife identity link and migrated profile.</p>
      <Link className="underline" to="/firebase-auth-preview">Sign in with Firebase</Link>
    </main>;
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Migration preview · authenticated Firebase API</p>
        <h1 className="text-2xl font-semibold">Your ShelfLife library</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.displayName || user.email}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={loadFirstPage} disabled={loading}>Refresh</button>
        <button className="rounded border px-3 py-2 text-sm" onClick={() => signOutFirebase()}>Sign out</button>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-auth-preview">Auth diagnostics</Link>
        <Link className="rounded border px-3 py-2 text-sm" to="/firebase-groups-preview">Groups preview</Link>
      </div>
    </header>

    <Notice error={error}>{notice}</Notice>
    {(error.includes("identity link") || error.includes("migration is not complete")) && <p className="rounded border p-3 text-sm text-muted-foreground">This account has not been linked to an existing ShelfLife identity and migrated profile. No blank profile will be created and no other reader's data will be exposed.</p>}

    <section className="grid gap-4 md:grid-cols-2">
      <form className="space-y-3 rounded-lg border p-4" onSubmit={createBook}>
        <h2 className="font-semibold">Add a book</h2>
        <label className="block space-y-1 text-sm">Title *
          <input className="w-full rounded border px-3 py-2" value={bookForm.title} onChange={(event) => setBookForm((value) => ({ ...value, title: event.target.value }))} maxLength={300} required />
        </label>
        <label className="block space-y-1 text-sm">Author
          <input className="w-full rounded border px-3 py-2" value={bookForm.author} onChange={(event) => setBookForm((value) => ({ ...value, author: event.target.value }))} maxLength={300} />
        </label>
        <label className="block space-y-1 text-sm">Status
          <select className="w-full rounded border px-3 py-2" value={bookForm.status} onChange={(event) => setBookForm((value) => ({ ...value, status: event.target.value }))}>
            <option value="to_read">To read</option><option value="reading">Reading</option><option value="read">Read</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">Shelf
          <select className="w-full rounded border px-3 py-2" value={bookForm.shelfId} onChange={(event) => setBookForm((value) => ({ ...value, shelfId: event.target.value }))}>
            <option value="">No shelf</option>{shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
          </select>
        </label>
        <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" type="submit" disabled={saving === "create-book" || !bookForm.title.trim()}>{saving === "create-book" ? "Saving…" : "Add book"}</button>
      </form>

      <form className="space-y-3 rounded-lg border p-4" onSubmit={createShelf}>
        <h2 className="font-semibold">Create a shelf</h2>
        <label className="block space-y-1 text-sm">Name *
          <input className="w-full rounded border px-3 py-2" value={shelfForm.name} onChange={(event) => setShelfForm((value) => ({ ...value, name: event.target.value }))} maxLength={120} required />
        </label>
        <label className="block space-y-1 text-sm">Description
          <textarea className="w-full rounded border px-3 py-2" rows={2} value={shelfForm.description} onChange={(event) => setShelfForm((value) => ({ ...value, description: event.target.value }))} maxLength={1000} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shelfForm.is_private} onChange={(event) => setShelfForm((value) => ({ ...value, is_private: event.target.checked }))} /> Private shelf</label>
        <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" type="submit" disabled={saving === "create-shelf" || !shelfForm.name.trim()}>{saving === "create-shelf" ? "Saving…" : "Create shelf"}</button>
      </form>
    </section>

    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Books</h2><span className="text-xs text-muted-foreground">{books.length} loaded</span></div>
      {books.length === 0 && !loading && <p className="text-sm text-muted-foreground">No migrated books found.</p>}
      {books.map((book) => <article key={book.id} className="space-y-3 rounded-lg border p-3">
        {editingBook?.id === book.id ? (
          <form className="grid gap-2 md:grid-cols-2" onSubmit={saveBook}>
            <input className="rounded border px-3 py-2" aria-label="Book title" value={editingBook.title} onChange={(event) => setEditingBook((value) => ({ ...value, title: event.target.value }))} required />
            <input className="rounded border px-3 py-2" aria-label="Book author" value={editingBook.author} onChange={(event) => setEditingBook((value) => ({ ...value, author: event.target.value }))} />
            <select className="rounded border px-3 py-2" aria-label="Book status" value={editingBook.status} onChange={(event) => setEditingBook((value) => ({ ...value, status: event.target.value }))}><option value="to_read">To read</option><option value="reading">Reading</option><option value="read">Read</option></select>
            <select className="rounded border px-3 py-2" aria-label="Book shelf" value={editingBook.shelfId} onChange={(event) => setEditingBook((value) => ({ ...value, shelfId: event.target.value }))}><option value="">No shelf</option>{shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select>
            <div className="flex gap-2"><button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={saving === "book:" + book.id}>Save</button><button className="rounded border px-3 py-2 text-sm" type="button" onClick={() => setEditingBook(null)}>Cancel</button></div>
          </form>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-medium">{book.title || "Untitled book"}</p><p className="text-xs text-muted-foreground">{book.author || "Author not recorded"} · {book.status || "Status not set"}</p><p className="mt-1 text-xs text-muted-foreground">{(book.shelfIds || []).map((id) => shelves.find((shelf) => shelf.id === id)?.name || "Shelf").join(", ") || "No shelf"} · versioned record</p></div>
            <div className="flex gap-2"><button className="rounded border px-3 py-2 text-sm" onClick={() => setEditingBook({ id: book.id, version: book.version, title: book.title || "", author: book.author || "", status: book.status || "to_read", shelfId: (book.shelfIds || [])[0] || "" })}>Edit</button><button className="rounded border px-3 py-2 text-sm" onClick={() => setDeleteTarget({ kind: "book", id: book.id, record: book })}>Delete</button></div>
          </div>
        )}
        {deleteTarget?.kind === "book" && deleteTarget.id === book.id && <div className="flex items-center justify-between gap-3 rounded bg-muted p-2 text-sm"><span>Soft-delete this book?</span><div className="flex gap-2"><button className="rounded bg-destructive px-3 py-1.5 text-destructive-foreground" onClick={removeRecord} disabled={saving === "delete:" + book.id}>Confirm</button><button className="rounded border px-3 py-1.5" onClick={() => setDeleteTarget(null)}>Cancel</button></div></div>}
      </article>)}
      {bookCursor && <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={() => loadMore("books")}>Load more books</button>}
    </section>

    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Shelves</h2><span className="text-xs text-muted-foreground">{shelves.length} loaded</span></div>
      {shelves.length === 0 && !loading && <p className="text-sm text-muted-foreground">No migrated shelves found.</p>}
      {shelves.map((shelf) => <article key={shelf.id} className="space-y-3 rounded-lg border p-3">
        {editingShelf?.id === shelf.id ? (
          <form className="grid gap-2 md:grid-cols-2" onSubmit={saveShelf}>
            <input className="rounded border px-3 py-2" aria-label="Shelf name" value={editingShelf.name} onChange={(event) => setEditingShelf((value) => ({ ...value, name: event.target.value }))} required />
            <input className="rounded border px-3 py-2" aria-label="Shelf description" value={editingShelf.description} onChange={(event) => setEditingShelf((value) => ({ ...value, description: event.target.value }))} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editingShelf.is_private} onChange={(event) => setEditingShelf((value) => ({ ...value, is_private: event.target.checked }))} /> Private shelf</label>
            <div className="flex gap-2"><button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={saving === "shelf:" + shelf.id}>Save</button><button className="rounded border px-3 py-2 text-sm" type="button" onClick={() => setEditingShelf(null)}>Cancel</button></div>
          </form>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-medium">{shelf.name || "Untitled shelf"}</p><p className="text-xs text-muted-foreground">{shelf.description || "No description"} · {shelf.is_private ? "Private" : "Visible"}</p><p className="mt-1 text-xs text-muted-foreground">versioned record</p></div>
            <div className="flex gap-2"><button className="rounded border px-3 py-2 text-sm" onClick={() => setEditingShelf({ id: shelf.id, version: shelf.version, name: shelf.name || "", description: shelf.description || "", is_private: shelf.is_private === true })}>Edit</button><button className="rounded border px-3 py-2 text-sm" onClick={() => setDeleteTarget({ kind: "shelf", id: shelf.id, record: shelf })}>Delete</button></div>
          </div>
        )}
        {deleteTarget?.kind === "shelf" && deleteTarget.id === shelf.id && <div className="flex items-center justify-between gap-3 rounded bg-muted p-2 text-sm"><span>Soft-delete this shelf and detach it from books?</span><div className="flex gap-2"><button className="rounded bg-destructive px-3 py-1.5 text-destructive-foreground" onClick={removeRecord} disabled={saving === "delete:" + shelf.id}>Confirm</button><button className="rounded border px-3 py-1.5" onClick={() => setDeleteTarget(null)}>Cancel</button></div></div>}
      </article>)}
      {shelfCursor && <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={() => loadMore("shelves")}>Load more shelves</button>}
    </section>

    {loading && <p className="text-sm text-muted-foreground" role="status">Loading Firebase library…</p>}
    <p className="text-xs text-muted-foreground">This preview uses authenticated Firebase APIs for paginated reads, create, version-checked update and soft deletion. It does not yet cover the full production reader UI, book-cover upload, import workflows or sharing UI. The main ShelfLife app remains on Base44 until the full feature set and migration gates pass.</p>
  </main>;
}
