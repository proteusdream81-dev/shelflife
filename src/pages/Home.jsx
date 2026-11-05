const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "format", label: "Format" },
  { value: "series", label: "Series" },
];

const GROUPINGS = [
  { value: "none", label: "No grouping" },
  { value: "format", label: "By format" },
  { value: "series", label: "By series" },
];

const byText = (a, b, field) =>
  String(a[field] || "").localeCompare(String(b[field] || ""), undefined, { sensitivity: "base" });

const sortBooks = (books, sort) => {
  const list = [...books];
  if (sort === "title") return list.sort((a, b) => byText(a, b, "title") || byText(a, b, "author"));
  if (sort === "author") return list.sort((a, b) => byText(a, b, "author") || byText(a, b, "title"));
  if (sort === "format") {
    return list.sort((a, b) => {
      const left = String(formatsOf(a)[0] || "").toLowerCase();
      const right = String(formatsOf(b)[0] || "").toLowerCase();
      return left.localeCompare(right) || byText(a, b, "title");
    });
  }
  if (sort === "series") {
    return list.sort((a, b) => {
      const left = seriesOf(a);
      const right = seriesOf(b);
      if (left && right) return left.localeCompare(right) || byText(a, b, "title");
      if (left) return -1;
      if (right) return 1;
      return byText(a, b, "title");
    });
  }
  return list;
};

const fetchLibrary = async () => {
  const all = [];
  let cursor;
  do {
    const page = await base44.entities.Book.list("-created_date", 200, cursor);
    all.push(...(page.items || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return all;
};

export default function Home() {
  const [books, setBooks] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("all");
  const [sort, setSort] = useState("newest");
  const [group, setGroup] = useState("none");
  const [showWarnings, setShowWarnings] = useState(false);
  const [canNudge, setCanNudge] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const pendingRef = useRef({});

  const refresh = async () => {
    try {
      const fresh = await fetchLibrary();
      setBooks(fresh);
    } catch {
      setListError("We couldn't refresh your library right now.");
    }
  };

  const load = async () => {
    setListError("");
    try {
      const [rows, shelfList] = await Promise.all([fetchLibrary(), base44.entities.Shelf.list("-created_date", 100)]);
      setBooks(rows);
      setShelves(shelfList);
    } catch {
      setListError("We couldn't load your library right now.");
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    base44.auth
      .me()
      .then((me) => setCanNudge(Boolean(me?.invite_nudge_done !== true)))
      .catch(() => {});
  }, []);

  const dismissInvite = async () => {
    setShowInvite(false);
    await base44.auth.updateMe({ invite_nudge_done: true });
  };

  const applyBookChange = async (id, patch = {}) => {
    if (id && Object.keys(patch).length) {
      pendingRef.current = { ...pendingRef.current, [id]: { ...(pendingRef.current[id] || {}), ...patch } };
      setBooks((prev) => prev.map((book) => (book.id === id ? { ...book, ...patch } : book)));
    }
  };

  const filteredBooks = useMemo(() => {
    const matched = search.trim()
      ? books.filter((book) =>
          String(book.title || "").toLowerCase().includes(search.toLowerCase()) ||
          String(book.author || "").toLowerCase().includes(search.toLowerCase()) ||
          (book.isbn || "").toLowerCase().includes(search)
        )
      : books;
    const byFormat = format === "all"
      ? matched
      : matched.filter((book) => formatsOf(book).includes(format));
    return sortBooks(byFormat, sort);
  }, [books, search, format, sort]);

  const publicShelves = shelves.filter((s) => !s.is_private);
  const privateShelves = shelves.filter((s) => s.is_private);

  const booksForShelf = (shelf) => {
    const byId = filteredBooks.filter((b) => b.shelf_id === shelf.id);
    if (!isSystemShelf(shelf)) return byId;
    const wanted = statusForSystemShelf(shelf);
    if (!wanted) return byId;
    const byStatus = filteredBooks.filter(
      (b) => b.status === wanted && b.shelf_id !== shelf.id
    );
    if (!byStatus.length) return byId;
    const seen = new Set(byId.map((b) => b.id));
    return [...byId, ...byStatus.filter((b) => !seen.has(b.id))];
  };

  const shelfBooksById = useMemo(() => {
    const byId = new Map();
    books.forEach((book) => {
      const key = book.shelf_id || "";
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key).push(book);
    });
    shelves.forEach((shelf) => {
      if (!isSystemShelf(shelf)) return;
      const wanted = statusForSystemShelf(shelf);
      if (!wanted) return;
      const existing = byId.get(shelf.id) || [];
      const extras = books.filter((b) => b.status === wanted && b.shelf_id !== shelf.id);
      const seen = new Set(existing.map((b) => b.id));
      byId.set(shelf.id, [...existing, ...extras.filter((b) => !seen.has(b.id))]);
    });
    return byId;
  }, [books, shelves]);

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark vp-mark-icon">
                <img src={APP_ICON} alt="" width="42" height="42" className="h-full w-full object-contain" />
              </div>
              <div className="vp-brandtxt">
                <strong>Your library</strong>
                <span>Books on your shelves</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-5xl mx-auto">
        <FoundingTesterBanner />
        {showInvite && <InviteNudge onDone={dismissInvite} />}
        {listError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" strokeWidth={2} />
              {listError}
            </span>
            <button type="button" className="vp-btn vp-small" onClick={refresh}>Try again</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FormatFilter value={format} onChange={setFormat} />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
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
            books={booksForShelf(shelf)}
            allBooks={shelfBooksById.get(shelf.id) || []}
            onSaved={applyBookChange}
            showWarnings={showWarnings}
          />
        ))}
        {privateShelves.length > 0 && (
          <>
            <button type="button" className="vp-privateToggle" onClick={() => setShowPrivate((v) => !v)}>
              {showPrivate ? "Hide" : "Show"} private shelves
            </button>
            {showPrivate && privateShelves.map((shelf) => (
              <ShelfSection
                key={shelf.id}
                shelf={shelf}
                books={booksForShelf(shelf)}
                allBooks={shelfBooksById.get(shelf.id) || []}
                onSaved={applyBookChange}
                showWarnings={showWarnings}
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
    </div>
  );
}
