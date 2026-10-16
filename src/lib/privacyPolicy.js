// The policy the app publishes, kept as data so the page stays a page: who the app belongs to,
// when the policy was last touched, and then one clause per subject. The headings are held in
// title case and set in capitals by the page's own styling, so the wording never drifts from
// the policy text itself.

export const POLICY_UPDATED = "Last updated: October 2026";

export const POLICY_OPERATOR =
  "ShelfLife is built and operated by Code Lustre (Schrader Capitol), Manilla NSW, Australia.";

export const POLICY_SECTIONS = [
  {
    heading: "What we collect",
    body: "Your account name and email (through the login provider), the books, shelves, ratings, notes, covers and photos you add, and the social connections you create (follows, blocks, profile information).",
  },
  {
    heading: "Imported files",
    body: "When you import a CSV (Goodreads, StoryGraph, LibraryThing or Bookmory), we process it to add books and ratings to your account, then discard the file.",
  },
  {
    heading: "How we use your data",
    body: "To run your account, display your shelves, and enable the social features you opt into. Shelves you mark private stay private and are never shown to other users.",
  },
  {
    heading: "Third parties",
    body: "Book searches and cover lookups are sent to Google Books, Open Library and Hardcover. Buy buttons point to retailers such as Amazon, and we may earn a small affiliate commission; no personal data is shared with them beyond what a link click contains. We never sell your personal data.",
  },
  {
    heading: "Storage",
    body: "Your data is stored with our platform providers (Base44 and its infrastructure). Photos you upload are stored in file storage tied to your account.",
  },
  {
    heading: "Your rights",
    body: "You can edit or delete your books, shelves, photos and account at any time. Deleting your account removes your books, shelves, ratings and social connections.",
  },
  {
    heading: "Contact",
    body: "Questions or requests: schradercapitol@gmail.com",
  },
];