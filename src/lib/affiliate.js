// Amazon Associates. A tracking tag is only ever stamped on a link for a storefront we
// hold an account for. Approval for the Australian store is still pending, so the table
// below holds empty placeholders: drop the real tag in and every Amazon link the app shows
// carries it, including links saved on books from before.
export const AFFILIATE_TAGS = {
  "amazon.com.au": "", // Australian Associates — pending approval
  "amazon.com": "",
  "amazon.co.uk": "",
  "amazon.ca": "",
};

// The store the app itself calls home, used when a reader's region can't be worked out.
export const FALLBACK_STOREFRONT = "amazon.com.au";

// The tag can be swapped without a rebuild — a runtime value wins over the table above:
//   window.SHELFLIFE_AFFILIATE_TAG = "yourname-22"      (any page in the app)
//   localStorage.setItem("shelflife.affiliateTag", "yourname-22")
const RUNTIME_KEY = "shelflife.affiliateTag";

export function runtimeAffiliateTag() {
  if (typeof window === "undefined") return "";
  const set = window.SHELFLIFE_AFFILIATE_TAG;
  if (typeof set === "string" && set.trim()) return set.trim();
  try {
    return (window.localStorage?.getItem(RUNTIME_KEY) || "").trim();
  } catch {
    return "";
  }
}

export const affiliateTagFor = (storefront) => runtimeAffiliateTag() || AFFILIATE_TAGS[storefront] || "";

// Shown beside the buy links. Wording that stays true whether or not a tag is on the link.
export const AFFILIATE_DISCLOSURE = "Some buy links may earn ShelfLife a small commission, at no extra cost to you.";