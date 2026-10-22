// Where a book can be bought. This is the one place a link to a shop is built, so a book shows
// a single Amazon link — pointed at the reader's own storefront and tagged where we hold an
// account — beside the other shops it carries. Every screen renders its buy links through
// OutboundLink, so the links behave the same wherever they are tapped.

// Amazon Associates. We hold one account, in Australia, so its tag rides on the Australian
// storefront's links and on no other: a tag on a store we have no account with earns nothing
// and only clutters the address.
export const AFFILIATE_TAGS = { "amazon.com.au": "shelflife01-22" };

// The store the app itself calls home, used when a reader's region can't be worked out.
export const FALLBACK_STOREFRONT = "amazon.com.au";

// Shown beside the buy links, close enough to them to be read before a tap. The fuller line
// belongs in Settings, where a reader goes looking for the detail.
export const AFFILIATE_DISCLOSURE = "ShelfLife earns from qualifying purchases.";
export const AFFILIATE_DISCLOSURE_LONG =
  "As an Amazon Associate, ShelfLife earns from qualifying purchases. Buy links to the Amazon AU store carry our affiliate tag; links to other Amazon stores and to bookshops do not. You never pay more either way.";

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

// What each storefront serves, for the region picker in Settings.
const STOREFRONT_LABELS = {
  "amazon.com.au": "Australia / New Zealand",
  "amazon.com": "United States",
  "amazon.co.uk": "United Kingdom / Ireland",
  "amazon.ca": "Canada",
  "amazon.de": "Germany / Austria / Switzerland",
  "amazon.fr": "France / Belgium",
  "amazon.it": "Italy",
  "amazon.es": "Spain",
  "amazon.co.jp": "Japan",
  "amazon.in": "India",
  "amazon.nl": "Netherlands",
  "amazon.se": "Sweden",
  "amazon.pl": "Poland",
  "amazon.com.br": "Brazil",
  "amazon.com.mx": "Mexico",
  "amazon.sg": "Singapore",
  "amazon.ae": "United Arab Emirates",
};

// "auto" leaves the storefront to the reader's own region; every other value pins it.
export const STOREFRONT_OPTIONS = [
  { value: "auto", label: "Automatic — my region" },
  ...Object.entries(STOREFRONT_LABELS).map(([value, label]) => ({ value, label: `${label} (${value})` })),
];

const clean = (value) => String(value ?? "").trim();

const isStorefront = (value) => /^amazon\.[a-z.]{2,6}$/i.test(clean(value));

// The storefront this reader picked in Settings, or "" when they left it to their region.
export function savedStorefront() {
  if (typeof window === "undefined") return "";
  try {
    const chosen = clean(window.localStorage?.getItem(STOREFRONT_PREFERENCE_KEY));
    return isStorefront(chosen) ? chosen : "";
  } catch {
    return "";
  }
}

// Remembers the reader's choice from that point on, in this browser and this installed app.
export function setStorefront(value) {
  if (typeof window === "undefined") return;
  try {
    const chosen = clean(value);
    if (isStorefront(chosen)) window.localStorage.setItem(STOREFRONT_PREFERENCE_KEY, chosen);
    else window.localStorage.removeItem(STOREFRONT_PREFERENCE_KEY);
  } catch {
    // Storage unavailable — links keep following the reader's region.
  }
}

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
  const chosen = savedStorefront();
  if (chosen) return chosen;
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
    // "www.amazon.com.au" and "amazon.com.au" are the same storefront for our purposes.
    const tag = AFFILIATE_TAGS[parsed.hostname.toLowerCase().replace(/^www\./, "")];
    if (!tag) return url;
    parsed.searchParams.set("tag", tag);
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
export const buyLinksDisclosureLong = AFFILIATE_DISCLOSURE_LONG;

// Where a reader can read more about an author, for the author page. It goes through the same
// tag rule as every other Amazon address, so the AU store carries our tag and the rest don't.
export function authorSearchUrl(author, storefront = "") {
  const name = clean(author);
  if (!name) return "";
  const store = storefront || amazonStorefront();
  return withAffiliateTag(`https://www.${store}/s?k=${encodeURIComponent(name)}`);
}