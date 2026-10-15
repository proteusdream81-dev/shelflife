// Authors reach the shelves in more than one shape: a catalogue writes "Rebecca Yarros", a
// Goodreads export writes "Yarros, Rebecca", and a co-authored book names two people. So a
// name is compared as a set of words, which meets in the middle of those spellings.

const nameKey = (value) =>
  [...new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f]+/g, " ")
      .split(" ")
      .filter(Boolean)
  )]
    .sort()
    .join(" ");

// "Yarros, Rebecca" is how a shelf holds a name, and "Rebecca Yarros" is how a person says
// it, so a single surname-first pair is turned back the right way for display.
export const displayAuthor = (author) => {
  const text = String(author || "").trim();
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const short = (part) => part.split(/\s+/).length <= 2;
  if (parts.length === 2 && short(parts[0]) && short(parts[1])) return `${parts[1]} ${parts[0]}`;
  return text;
};

export const authorMatches = (author, name) => {
  const wanted = nameKey(name);
  if (!wanted) return false;
  const text = String(author || "");
  if (nameKey(text) === wanted) return true;
  return text
    .split(",")
    .map((part) => part.trim())
    .some((part) => part && nameKey(part) === wanted);
};

// The one word a lookup can be run on, whichever way round the name is written.
export const authorSearchTerm = (name) => {
  const words = String(name || "").split(/[^A-Za-z\u00c0-\u024f'.-]+/).filter((word) => word.length > 1);
  if (!words.length) return String(name || "").trim();
  return words.reduce((best, word) => (word.length > best.length ? word : best), words[0]);
};

// A name is only a search pattern once its own punctuation is escaped, so "King, Stephen"
// can't be read as one.
export const authorPattern = (name) => String(name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const authorPath = (name) => `/author/${encodeURIComponent(String(name || "").trim())}`;

// A route hands the name back decoded, but a name must never be able to break the page.
export const authorFromParam = (raw) => {
  try {
    return decodeURIComponent(raw || "").trim();
  } catch {
    return String(raw || "").trim();
  }
};