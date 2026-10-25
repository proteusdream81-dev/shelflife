// What the account deletion page says, kept as data so the page stays a page. A paragraph or a
// list item may carry a link as [label](address) — the page turns it into a real link — so the
// wording here is exactly the wording readers see.

export const DELETION_HEADLINE = "Delete your ShelfLife account";

export const DELETION_INTRO =
  "We're sorry to see you go. You can delete your ShelfLife account and personal data at any time, in two ways:";

export const DELETION_METHODS = [
  {
    heading: "Method 1 - In the app",
    blocks: [
      {
        type: "p",
        text: `Open ShelfLife > Settings > Account > Delete Account > Confirm. Deletion is immediate and irreversible.`,
      },
    ],
  },
  {
    heading: "Method 2 - Web form",
    blocks: [
      {
        type: "p",
        text: `Enter the email address linked to your ShelfLife account below and submit the request. We will send a confirmation link to that email; click it within 24 hours to confirm deletion. Your account and data are then permanently deleted within 30 days.`,
      },
    ],
  },
];

export const DELETION_SECTIONS = [
  {
    heading: "What gets deleted",
    blocks: [
      {
        type: "ul",
        items: [
          `Account and profile data: email, auth tokens, username, display name, bio, avatar, preferences.`,
          `Reading history and lists: saved books, custom shelves, TBR list, reading logs, dates, progress, stats.`,
          `Your content: written reviews, star ratings, tags, private notes, quote highlights.`,
          `Social data and imports: friends, shared shelf memberships, activity feed entries, and imported CSV data.`,
        ],
      },
    ],
  },
  {
    heading: "What we keep, and why",
    blocks: [
      {
        type: "ul",
        items: [
          `Fully anonymized, aggregate statistics (e.g., total downloads, popular books) that can no longer be linked to you.`,
          `Security and diagnostic logs retained up to 60 days for fraud prevention.`,
          `Financial transaction records where retention is legally required for tax compliance.`,
        ],
      },
    ],
  },
  {
    heading: "Timeline",
    blocks: [
      {
        type: "p",
        text: `Your account is deactivated immediately; profile and reviews disappear right away; all personal data is purged from production within 30 days and from encrypted backups within 30-60 days.`,
      },
    ],
  },
];

export const DELETION_CONTACT = {
  heading: "Contact",
  blocks: [
    {
      type: "p",
      text: `[privacy@shelflifetbr.com](mailto:privacy@shelflifetbr.com) | [https://shelf-life-112ee3ed.base44.app](https://shelf-life-112ee3ed.base44.app)`,
    },
  ],
};