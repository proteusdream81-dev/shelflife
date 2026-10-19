// What the account deletion page says, kept as data so the page stays a page. The headings are
// held in sentence case and set in capitals by the panel's own styling, so the wording here is the
// wording readers see.

export const DELETION_HEADLINE = "Delete your ShelfLife account";

export const DELETION_INTRO =
  "You can delete your ShelfLife account from this page, whether or not you are signed in. Deletion is permanent: your shelves, your books and your reading history go with it, and nothing can be restored afterwards.";

export const DELETION_SECTIONS = [
  {
    heading: "What gets deleted",
    body: "Everything your account holds: your profile and your sign-in, every shelf and every book on it, each book's reading status, rating, notes, format and any cover image you uploaded, your imported library and its history, the readers you follow and the readers who follow you, your blocks, your book clubs and the invitations you sent or received, and the small records our servers keep about the searches you have run. ShelfLife has no public review or comment feature, so the ratings and notes you keep are private to you, and they are deleted with the books they belong to.",
  },
  {
    heading: "How long it takes",
    body: "Deletion is immediate. The moment it finishes, the account and everything in it is gone, you are signed out, and there is no way to undo it. There is no waiting period and no cooling-off window.",
  },
  {
    heading: "Backups",
    body: "Our platform keeps database backups in case of disaster. A deleted account can sit inside one of those copies for up to 30 days, and is purged from them on a rolling cycle within that time. Backups are never used to bring an account back, and nothing in them is read for any other purpose.",
  },
  {
    heading: "Book club chats",
    body: "Messages you have already posted in a book club's live chat belong to that group's conversation rather than to your account, so they are left as they are when your account goes. Everything else you wrote is deleted.",
  },
  {
    heading: "Kept for legal or security reasons",
    body: "Nothing in your account is kept for legal reasons. What remains is anonymous and not tied to you: counts such as how many readers joined in a week, and the platform's own request logs, which carry no account details. Neither can be traced back to an account that no longer exists.",
  },
  {
    heading: "Third parties and other readers",
    body: "Your data is never sold, and never shared with third parties for their own use. Book searches and cover lookups send only a title, an author or an ISBN to public catalogues such as Google Books, Open Library and Hardcover, and nothing about you goes with them. Other readers lose every trace of you as well: your shared shelves close, and your follow, your name and your club memberships come out of their reading circle.",
  },
  {
    heading: "Deleting inside the app",
    body: "Signed in? Settings has the same delete button, on the same account, for the same result. Use whichever is easier.",
  },
  {
    heading: "Need help?",
    body: "Questions about deleting an account reach us at schradercapitol@gmail.com. Our Privacy Policy explains what ShelfLife collects, why, and where it is stored.",
  },
];