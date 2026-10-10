// Amazon searches saved before the title/author fallback existed use the ISBN
// alone, and Amazon shows nothing when it doesn't stock that edition — so the
// stored search is widened here with the title and author, which its search
// matches instead. Links that already carry more than the ISBN, or that point
// anywhere else, are left untouched.
export function widenAmazonSearch(url, { isbn, title, author } = {}) {
  const extra = [title, author].map((v) => String(v || "").trim()).filter(Boolean);
  const cleanIsbn = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if (!extra.length || !cleanIsbn) return url;
  if (!/^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(String(url))) return url;

  const param = String(url).match(/[?&]k=([^&]*)/);
  if (!param) return url;

  const searched = decodeURIComponent(param[1].replace(/\+/g, " ")).trim();
  if (searched !== cleanIsbn) return url;

  const separator = param[0][0] === "&" ? "&" : "?";
  const query = encodeURIComponent([cleanIsbn, ...extra].join(" "));
  return url.replace(param[0], `${separator}k=${query}`);
}