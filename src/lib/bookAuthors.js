// A book's author field can name several people ("Terry Pratchett, Neil Gaiman"), so a page
// about one author asks the server for a rough match and then keeps only the books that
// really carry that name.

export const authorParts = (author) =>
  String(author || "")
    .split(/\s*,\s*|\s*;\s*|\s+&\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

export const firstAuthor = (author) => authorParts(author)[0] || "";

export const authorMatches = (author, name) => {
  const wanted = String(name || "").trim().toLowerCase();
  return !!wanted && authorParts(author).some((part) => part.toLowerCase() === wanted);
};

// A name is only a search pattern once its own punctuation is escaped, so "King, Stephen"
// can't be read as one.
export const authorPattern = (name) =>
  String(name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const authorPath = (name) => `/author/${encodeURIComponent(String(name || "").trim())}`;

// A route hands the name back decoded, but a name must never be able to break the page.
export const authorFromParam = (raw) => {
  try {
    return decodeURIComponent(raw || "").trim();
  } catch {
    return String(raw || "").trim();
  }
};