// A change that has just been saved is kept in front of the list until the server hands it
// back. A read taken a moment after a write can still return the older row, and letting that
// through would put a book back on the shelf — often a private one — that the reader has just
// moved it off, making the save look as though it never happened.

const same = (a, b) => (Array.isArray(a) || Array.isArray(b)
  ? JSON.stringify(a) === JSON.stringify(b)
  : a === b);

// The saved values, laid over whatever the server just returned.
export function mergePending(books = [], pending = {}) {
  return books.map((book) => (pending[book.id] ? { ...book, ...pending[book.id] } : book));
}

// The saved changes the server now agrees with no longer have to be held; the rest are still
// shown as the reader saved them.
export function settlePending(books = [], pending = {}) {
  const next = { ...pending };
  books.forEach((book) => {
    const patch = next[book.id];
    if (!patch) return;
    if (Object.keys(patch).every((key) => same(book[key], patch[key]))) delete next[book.id];
  });
  return next;
}