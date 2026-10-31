// System shelves that correspond 1:1 with reading status.
// Used so that changing a book's status also moves it onto the matching shelf,
// and so the Currently Reading / Read / To Read shelves stay complete.

const STATUS_TO_ROLE = {
  reading: "reading",
  read: "read",
  to_read: "to_read",
};

const ROLE_MATCHERS = {
  reading: /(currently[-\s]?reading|in progress|started|paused|on hold)/i,
  read: /\b(read|finished|completed|complete|done)\b/i,
  to_read: /(to[-\s]?read|tbr|want[-\s]?to[-\s]?read|wishlist|unread|not read)/i,
};

/** Return the reader's shelf that plays the given status role, if any. */
export function systemShelfForStatus(shelves = [], status) {
  const role = STATUS_TO_ROLE[status];
  if (!role) return null;
  const matcher = ROLE_MATCHERS[role];
  if (!matcher) return null;
  return (shelves || []).find((s) => matcher.test(String(s?.name || "").trim())) || null;
}

/** True when this shelf is one of the three system status shelves. */
export function isSystemShelf(shelf) {
  const name = String(shelf?.name || "").trim();
  return Object.values(ROLE_MATCHERS).some((re) => re.test(name));
}

/** Status that this system shelf represents, or "". */
export function statusForSystemShelf(shelf) {
  const name = String(shelf?.name || "").trim();
  for (const [status, re] of Object.entries(ROLE_MATCHERS)) {
    // ROLE_MATCHERS keys are the roles; map back to status values
    if (re.test(name)) {
      if (status === "reading") return "reading";
      if (status === "read") return "read";
      if (status === "to_read") return "to_read";
    }
  }
  return "";
}
