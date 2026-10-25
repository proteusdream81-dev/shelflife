// The address the public site answers on today.
//
// shelflifetbr.com is the address we want to hand out, but it currently has no DNS record at all,
// so every link the app creates or shows points at the app's own published address instead: a
// reader who taps one still lands on ShelfLife. Once the domain resolves again, changing this one
// line puts every link back on it.
export const SITE_URL = "https://meek-shelflife-reader-hub.base44.app";