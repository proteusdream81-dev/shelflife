// Where a book can be bought. This is the one place a link to a shop is built, so a book shows
// a single Amazon link — pointed at the reader's own storefront and tagged where we hold an
// account — beside the other shops it carries. Every screen renders its buy links through
// OutboundLink, so the links behave the same wherever they are tapped.

// Amazon Associates. Empty for now: drop the real tag in here and every Amazon link the app
// builds carries it — saved links and new ones alike — with no call site touched.
export const AFFILIATE_TAG = "";

// The store the app itself calls home, used when a reader's region can't be worked out.
export const FALLBACK_STOREFRONT = "amazon.com.au";

// Shown beside the buy links. Wording that stays true whether or not a tag is on the link.
export const AFFILIATE_DISCLOSURE = "Some buy links may earn ShelfLife a small commission, at no extra cost to you.";

// Matched against a hostname, so a look-alike domain such as
// amazon.com.au.someshop.example never gets the tag.
const AMAZON_HOST = /(^|\.)amazon\.[a-z.]{2,6}$/i;
const SEARCH_QUERY = /[?&]k=([^&]*)/;
const ISBN_TOKEN = /(?:^|\s)\d{9}[\dXx](?=\s|$)|(?:^|\s)\d{13}(?=\s|$)/;

// The Amazon storefront serving each region.
const STOREFRONTS = {
  AU: "amazon.com.au",
  NZ: "amazon.com.au",
  US: "amazon.com",
  GB: "amazon.co.uk",
  UK: "amazon.co.uk",
  IE: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  AT: "amazon.de",
  CH: "amazon.de",
  FR: "amazon.fr",
  BE: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
  JP: "amazon.co.jp",
  IN: "amazon.in",
  NL: "amazon.nl",
  SE: "amazon.se",
  PL: "amazon.pl",
  BR: "amazon.com.br",
  MX: "amazon.com.mx",
  SG: "amazon.sg",
  AE: "amazon.ae",
};

const STOREFRONT_PREFERENCE_KEY = "shelflife.storefront";

const clean = (value) => String(value ?? "").trim();

// A saved link is shown only when it is a real web address. Anything else — javascript:,
// data:, a malformed value — would run as script the moment a reader taps it.
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

const hostName = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export const cleanIsbn = (value) => String(value ?? "").replace(/[^0-9Xx]/g, "");

// The storefront a reader should be sent to: the one for their region, so a UK reader
// isn't pushed to the Australian store, with the app's own store as the fallback.
export function amazonStorefront() {
  if (typeof window === "undefined") return FALLBACK_STOREFRONT;
  try {
    const chosen = (window.localStorage?.getItem(STOREFRONT_PREFERENCE_KEY) || "").trim();
    if (/^amazon\.[a-z.]{2,6}$/i.test(chosen)) return chosen;
  } catch {
    // No stored preference — the reader's own locale decides instead.
  }
  try {
    const locale = navigator.languages?.[0] || navigator.language || "";
    const region = String(locale).split("-")[1]?.toUpperCase();
    if (region && STOREFRONTS[region]) return STOREFRONTS[region];

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^Australia\//.test(zone)) return "amazon.com.au";
    if (/^Pacific\/Auckland$/.test(zone)) return "amazon.com.au";
    if (/^Europe\/London$/.test(zone)) return "amazon.co.uk";
  } catch {
    // A browser that answers neither question falls back to the app's own store.
  }
  return FALLBACK_STOREFRONT;
}

// Amazon matches a title and author far more reliably than an ISBN — a book has several,
// and theirs is often a different edition — so a saved search that uses an ISBN is
// rewritten to search by title and author. A search that already looks the book up that
// way is kept as it stands.
function searchTermFor(url, book) {
  const query = [clean(book?.title), clean(book?.author)].filter(Boolean).join(" ");
  const searched = decodeURIComponent((clean(url).match(SEARCH_QUERY) || [])[1] || "")
    .replace(/\+/g, " ")
    .trim();
  if (searched && !ISBN_TOKEN.test(searched)) return searched;
  return query || cleanIsbn(book?.isbn);
}

// The tag goes on any Amazon address the app shows, whatever storefront it points at: a saved
// link can name a store other than the reader's own, and a tag that only matched one host left
// those links untracked.
function withAffiliateTag(url) {
  try {
    const parsed = new URL(url);
    if (!AFFILIATE_TAG) return url;
    if (!AMAZON_HOST.test(parsed.hostname)) return url;
    parsed.searchParams.set("tag", AFFILIATE_TAG);
    return parsed.toString();
  } catch {
    return url;
  }
}

// The shops shown on a book: one Amazon link for the reader's storefront, then any other
// shop the book already carries. A book that arrived without links — an import, or a book
// typed in by hand — still gets a working buy link.
export function buyLinksFor(book = {}) {
  const storefront = amazonStorefront();
  const stored = (Array.isArray(book?.buy_links) ? book.buy_links : [])
    .map((link) => ({ ...link, url: webUrl(link?.url) }))
    .filter((link) => link.url);

  const others = stored.filter((link) => !AMAZON_HOST.test(hostName(link.url)));
  const storedAmazon = stored.find((link) => AMAZON_HOST.test(hostName(link.url)));
  const term = searchTermFor(storedAmazon?.url || "", book);

  const links = [];
  if (term) {
    links.push({ name: "Amazon", url: `https://www.${storefront}/s?k=${encodeURIComponent(term)}` });
  }

  return [...links, ...others.map((link) => ({ name: link.name || "Shop", url: link.url }))]
    .map((link) => ({ ...link, url: withAffiliateTag(link.url) }));
}

export const buyLinksDisclosure = AFFILIATE_DISCLOSURE;

// Where a reader can read more about an author, for the author page.
export function authorSearchUrl(author, storefront = "") {
  const name = clean(author);
  if (!name) return "";
  const store = storefront || amazonStorefront();
  return `https://www.${store}/s?k=${encodeURIComponent(name)}`;
}