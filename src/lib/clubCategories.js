// The subjects a club can be filed under, shared by the club list, the form that starts a
// club, and the club finder, so a club started here is filed under the same word it is
// searched by. The club finder's backend function keeps its own copy of this list, since a
// function cannot import frontend code.
export const CLUB_CATEGORIES = [
  "Romance",
  "Fantasy",
  "Science fiction",
  "Mystery & thriller",
  "Literary fiction",
  "Historical fiction",
  "Horror",
  "Young adult",
  "Non-fiction",
  "Biography & memoir",
  "Classics",
  "Poetry",
  "Self-development",
];

// A club found out in the world comes back filed under one of these, but a listing can be
// described more loosely — "fantasy romance" — so the closest subject is offered when a
// reader starts their own club from one.
export function nearestCategory(value) {
  const wanted = String(value || "").toLowerCase().trim();
  if (!wanted) return "";
  const exact = CLUB_CATEGORIES.find((category) => category.toLowerCase() === wanted);
  if (exact) return exact;
  return CLUB_CATEGORIES.find((category) => wanted.includes(category.toLowerCase())) || "";
}