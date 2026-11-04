// System shelves that correspond 1:1 with reading status.
// Used so that changing a book's status also moves it onto the matching shelf,
// and so the Currently Reading / Read / To Read shelves stay complete.

const STATUS_TO_ROLE = {
  reading: "reading",
  read: "read",
  to_read: "to_read",
};

const SEP = "[-_\\s]*";
export const SHELF_ROLE_PATTERNS = {
  reading: new RegExp(`^(currently${SEP}reading|now${SEP}reading|reading|in${SEP}progress|started|paused|on${SEP}hold|re-?reading)$`, "i"),
  dnf: new RegExp(`^(did${SEP}not${SEP}finish|dnf|abandoned|gave${SEP}up|not${SEP}finished)$`, "i"),
  to_read: new RegExp(`^(to${SEP}read|tbr|want${SEP}to${SEP}read|to${SEP}be${SEP}read|wish${SEP}list|unread|not${SEP}read)$`, "i"),
  read: new RegExp(`^(read|finished|completed|complete|done|have${SEP}read)$`, "i"),
};

const ROLE_MATCHERS = {
  reading: SHELF_ROLE_PATTERNS.reading,
  read: SHELF_ROLE_PATTERNS.read,
  to_read: SHELF_ROLE_PATTERNS.to_read,
};

export function systemShelfForStatus(shelves = [], status) {
  const role = STATUS_TO_ROLE[status];
  if (!role) return null;
  const matcher = ROLE_MATCHERS[role];
  if (!matcher) return null;
  return (shelves || []).find((s) => matcher.test(String(s?.name || "").trim())) || null;
}

export function isSystemShelf(shelf) {
  const name = String(shelf?.name || "").trim();
  return Object.values(ROLE_MATCHERS).some((re) => re.test(name));
}

export function statusForSystemShelf(shelf) {
  const name = String(shelf?.name || "").trim();
  for (const [status, re] of Object.entries(ROLE_MATCHERS)) {
    if (re.test(name)) {
      if (status === "reading") return "reading";
      if (status === "read") return "read";
      if (status === "to_read") return "to_read";
    }
  }
  return "";
}

export function bookIsOnShelf(book, shelfId) {
  if (!shelfId || !book) return false;
  if (book.shelf_id === shelfId) return true;
  return Array.isArray(book.shelf_ids) && book.shelf_ids.includes(shelfId);
}
