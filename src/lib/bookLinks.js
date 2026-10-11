const AMAZON_SEARCH = /^https?:\/\/(www\.)?amazon\.[a-z.]+\//i;
const SEARCH_QUERY = /[?&]k=([^&]*)/;
const ISBN_TOKEN = /(?:^|\s)\d{9}[\dXx](?=\s|$)|(?:^|\s)\d{13}(?=\s|$)/;

const clean = (value) => String(value ?? "").trim();

// A saved link is shown only when it is a real web address. Anything else —
// javascript:, data:, a malformed value — would run as script the moment a
// reader taps it, so those are dropped before they reach an href.
const webUrl = (value) => {
  const url = clean(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
};

export const cleanIsbn = (value) => String(value ?? "").replace(/[^0-9Xx]/g, "");

// Amazon matches a title and author far more reliably than an ISBN — a book has
// several, and theirs is often a different edition — so a saved Amazon search
// that uses an ISBN is rewritten to search by title and author alone. Searches
// that already look the book up that way are left as they are.
function titleAuthorSearch(url, book) {
  const query = [book.title, book.author].map(clean).filter(Boolean).join(" ");
  if (!query || !AMAZON_SEARCH.test(clean(url))) return url;

  const searched = decodeURIComponent((clean(url).match(SEARCH_QUERY) || [])[1] || "")
    .replace(/\+/g, " ")
    .trim();
  if (!searched || searched === query || !ISBN_TOKEN.test(searched)) return url;

  return clean(url).replace(/k=[^&]*/, `k=${encodeURIComponent(query)}`);
}

// The shops shown on a book: the saved links, searched by title and author,
// plus an Amazon lookup by ISBN for the rare book that search can't find.
export function buyLinksFor(book = {}) {
  const stored = (Array.isArray(book?.buy_links) ? book.buy_links : [])
    .map((link) => ({ ...link, url: webUrl(link?.url) }))
    .filter((link) => link.url);
  const links = stored.map((link) => ({ ...link, url: titleAuthorSearch(link.url, book) }));

  const isbn = cleanIsbn(book.isbn);
  const isbnUrl = `https://www.amazon.com.au/s?k=${isbn}`;
  if (isbn && stored.length && !links.some((link) => link.url === isbnUrl)) {
    links.push({ name: "Amazon (ISBN)", url: isbnUrl });
  }

  return links;
}