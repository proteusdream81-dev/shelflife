// Saved Amazon searches that lead with the ISBN find nothing when Amazon
// doesn't stock that edition — and a book has several ISBNs — so they are
// rewritten here to search the title and author first, keeping the ISBN as a
// trailing refinement. Searches that already lead with the title, and links to
// any other shop, are left untouched.
export function widenAmazonSearch(url, { isbn, title, author } = {}) {
  const extra = [title, author].map((v) => String(v || "").trim()).filter(Boolean);
  const cleanIsbn = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if (!extra.length || !cleanIsbn) return url;
  if (!/^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(String(url))) return url;

  const param = String(url).match(/[?&]k=([^&]*)/);
  if (!param) return url;

  const searched = decodeURIComponent(param[1].replace(/\+/g, " ")).trim();
  if (searched.split(/\s+/)[0] !== cleanIsbn) return url;

  const separator = param[0][0] === "&" ? "&" : "?";
  const query = encodeURIComponent([...extra, cleanIsbn].join(" "));
  return url.replace(param[0], `${separator}k=${query}`);
}