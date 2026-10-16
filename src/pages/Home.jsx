import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image } from "@/components/ui/image";
import { Plus, Search, Lock, Eye, EyeOff, Loader2, Library, Download, ArrowUpDown, AlertTriangle } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import ShelfSection from "@/components/tbr/ShelfSection";
import AddBookDialog from "@/components/tbr/AddBookDialog";
import ShelfForm from "@/components/tbr/ShelfForm";
import ImportLibraryDialog from "@/components/tbr/ImportLibraryDialog";
import FormatFilter from "@/components/tbr/FormatFilter";
import InviteNudge from "@/components/tbr/InviteNudge";
import { formatLabel, formatsOf } from "@/lib/bookMeta";
import PullToRefresh from "@/components/PullToRefresh";
import { APP_ICON, APP_TAGLINE, HERO_IMAGE } from "@/lib/brand";
import { mergePending, settlePending } from "@/lib/savedChanges";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "format", label: "Format" },
];

const byText = (a, b, field) =>
  String(a[field] || "").localeCompare(String(b[field] || ""), undefined, { sensitivity: "base" });

const sortBooks = (books, sort) => {
  const list = [...books];
  if (sort === "title") return list.sort((a, b) => byText(a, b, "title"));
  if (sort === "author") return list.sort((a, b) => byText(a, b, "author"));
  if (sort === "format") {
    return list.sort((a, b) => (formatsOf(a)[0] || "zz").localeCompare(formatsOf(b)[0] || "zz"));
  }
  return list; // already newest first, straight from the server
};

// The whole library, a page at a time. A reader with more books than one page holds would
// otherwise be shown part of their list, with the rest and their shelf counts missing.
const fetchLibrary = async () => {
  const all = [];
  let cursor;
  do {
    const page = await base44.entities.Book.filter({}, { sort: "-created_date", limit: 200, cursor });
    all.push(...(page.items || []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return all;
};

export default function Home() {
  const [shelves, setShelves] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [shelfFormOpen, setShelfFormOpen] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [format, setFormat] = useState("all");
  const [sort, setSort] = useState("newest");
  const [canNudge, setCanNudge] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Changes this reader has saved that the server has not handed back yet.
  const pendingRef = useRef({});

  // The reader's own saved values stay on screen until the server hands them back, so a read
  // that is a moment behind a write can't put a book back on the shelf it was moved off.
  const refresh = async () => {
    try {
      const fresh = await fetchLibrary();
      pendingRef.current = settlePending(fresh, pendingRef.current);
      setBooks(mergePending(fresh, pendingRef.current));
      setListError("");
      return true;
    } catch {
      setListError("We couldn't refresh your list just now. What you saved is still shown here.");
      return false;
    }
  };

  const load = async () => {
    try {
      let s = await base44.entities.Shelf.list("-created_date");
      if (s.length === 0) {
        const created = await base44.entities.Shelf.create({ name: "To Read" });
        s = [created];
      }
      setShelves(s);
      await refresh();
    } catch {
      setListError("We couldn't load your list. Pull down to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // The invite nudge is a once-only thing, shown the moment the first book lands.
  useEffect(() => {
    base44.auth
      .me()
      .then((user) => setCanNudge(!user?.invite_nudge_done))
      .catch(() => setCanNudge(false));
  }, []);

  useEffect(() => {
    if (canNudge && books.length === 1) setShowInvite(true);
  }, [canNudge, books]);

  const dismissInvite = async () => {
    setShowInvite(false);
    setCanNudge(false);
    await base44.auth.updateMe({ invite_nudge_done: true });
  };

  // A book that has just been saved shows where the reader put it straight away, and stays
  // that way while the list is re-read behind it.
  const applyBookChange = async (id, patch = {}) => {
    if (id && Object.keys(patch).length) {
      pendingRef.current = { ...pendingRef.current, [id]: { ...(pendingRef.current[id] || {}), ...patch } };
      setBooks((prev) => prev.map((book) => (book.id === id ? { ...book, ...patch } : book)));
    }
    await refresh();
  };

  const filteredBooks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? books.filter((b) =>
        (b.title || "").toLowerCase().includes(query) ||
        (b.author || "").toLowerCase().includes(query) ||
        (b.isbn || "").toLowerCase().includes(query)
      )
      : books;

    const byFormat = format === "all"
      ? matched
      : matched.filter((book) => formatsOf(book).includes(format));

    return sortBooks(byFormat, sort);
  }, [books, search, format, sort]);

  const publicShelves = shelves.filter((s) => !s.is_private);
  const privateShelves = shelves.filter((s) => s.is_private);
  const booksForShelf = (id) => filteredBooks.filter((b) => b.shelf_id === id);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="vp-page">
      <PullToRefresh onRefresh={load} />
      <header className="vp-top">
        <div className="vp-hero">
          <Image src={HERO_IMAGE} alt="" fittingType="fill" className="w-full h-full" />
        </div>
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                {/* The app's own icon, so the home screen wears the same mark the app does. */}
                <img src={APP_ICON} alt="" width="42" height="42" className="h-full w-full rounded-[14px] object-contain" />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>{APP_TAGLINE}</span>
              </div>
            </div>
            <div className="vp-actions">
              <button type="button" className="vp-btn" onClick={() => setShelfFormOpen(true)}>
                <Plus /> Shelf
              </button>
              <button type="button" className="vp-btn vp-primary" onClick={() => setAddOpen(true)}>
                <Plus /> Add book
              </button>
              <AppNav />
              <button
                type="button"
                className="vp-btn vp-icon"
                onClick={() => setImportOpen(true)}
                title="Import your library"
                aria-label="Import your library"
              >
                <Download strokeWidth={1.8} />
                <span className="hidden sm:inline">Import</span>
              </button>
            </div>
          </div>
          <label className="vp-search">
            <Search />
            <Input
              placeholder="Search your list by title or author..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="vp-input"
            />
          </label>
        </div>
      </header>

      <main className="vp-main max-w-5xl mx-auto">
        {showInvite && <InviteNudge onDone={dismissInvite} />}

        {/* A save or a refresh that failed says so here, rather than leaving the list looking
            as though nothing had happened. */}
        {listError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" strokeWidth={2} />
              {listError}
            </span>
            <button type="button" className="vp-btn vp-small" onClick={refresh}>Try again</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <FormatFilter value={format} onChange={setFormat} />
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.8} />
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label="Sort your list" className="h-10 w-[10.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filteredBooks.length === 0 && (search.trim() || format !== "all") && (
          <p className="vp-empty">
            {search.trim()
              ? `No books match “${search.trim()}”.`
              : `No ${formatLabel(format)} books in your list yet.`}
          </p>
        )}

        {publicShelves.map((shelf) => (
          <ShelfSection
            key={shelf.id}
            shelf={shelf}
            books={booksForShelf(shelf.id)}
            allShelves={shelves}
            onChange={load}
            onBookSaved={applyBookChange}
          />
        ))}

        {privateShelves.length > 0 && (
          <>
            <button type="button" className="vp-privateToggle" onClick={() => setShowPrivate((v) => !v)}>
              <Lock strokeWidth={1.8} />
              <span>{showPrivate ? "Hide private shelves" : `Show private shelves (${privateShelves.length})`}</span>
              {showPrivate ? <EyeOff className="vp-eye" strokeWidth={1.8} /> : <Eye className="vp-eye" strokeWidth={1.8} />}
            </button>
            {showPrivate && privateShelves.map((shelf) => (
              <ShelfSection
                key={shelf.id}
                shelf={shelf}
                books={booksForShelf(shelf.id)}
                allShelves={shelves}
                onChange={load}
                onBookSaved={applyBookChange}
                isPrivate
              />
            ))}
          </>
        )}

        {shelves.length === 0 && (
          <div className="vp-empty">
            <Library className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No shelves yet. Create one to start adding books.</p>
          </div>
        )}
      </main>

      <AddBookDialog open={addOpen} onOpenChange={setAddOpen} shelves={shelves} books={books} onAdded={load} />
      <ShelfForm open={shelfFormOpen} onOpenChange={setShelfFormOpen} onSaved={load} />
      <ImportLibraryDialog open={importOpen} onOpenChange={setImportOpen} shelves={shelves} onImported={load} />
    </div>
  );
}