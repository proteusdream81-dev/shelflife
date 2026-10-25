// The policy the app publishes, kept as data so the page stays a page: its title, the effective
// and updated dates, then one clause per numbered subject. A clause's text may carry a link as
// [label](address) — the page turns it into a real link — so the wording here is exactly the
// wording readers see.

export const POLICY_TITLE = "Privacy Policy for ShelfLife";

export const POLICY_META =
  "Effective Date: October 21, 2026 | Last Updated: October 21, 2026";

export const POLICY_SECTIONS = [
  {
    heading: "1. Introduction",
    blocks: [
      {
        type: "p",
        text: `Welcome to ShelfLife ("we," "our," or "us"), an Android book-tracking and reading application operated by Justin Schrader (website: [https://shelf-life-112ee3ed.base44.app](https://shelf-life-112ee3ed.base44.app)). ShelfLife is dedicated to helping readers organize their books, track reading progress, and share their love of reading with friends.`,
      },
      {
        type: "p",
        text: `This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the ShelfLife mobile application or our website at [https://shelf-life-112ee3ed.base44.app](https://shelf-life-112ee3ed.base44.app). By using ShelfLife, you agree to the collection and use of information in accordance with this policy.`,
      },
    ],
  },
  {
    heading: "2. Information We Collect",
    blocks: [
      {
        type: "p",
        lead: "a) Account and Profile Information:",
        text: `When you create an account (via email or Google Sign-In), we collect your email address, authentication credentials, display name, username, profile picture, and any bio you choose to provide.`,
      },
      {
        type: "p",
        lead: "b) Reading and Content Data:",
        text: `The books you add (including title, author, ISBN/ASIN, covers), custom shelves, TBR lists, reading status and progress, start/finish dates, star ratings, written reviews, private notes, quote highlights, and social connections such as friends and shared shelves. This includes data imported from CSV files (Goodreads, StoryGraph, Bookmory).`,
      },
      {
        type: "p",
        lead: "c) Technical and Usage Data:",
        text: `Device model, operating system version, app version, and diagnostic or crash logs to keep the app stable and secure.`,
      },
    ],
  },
  {
    heading: "3. How We Use Your Information",
    blocks: [
      {
        type: "ul",
        items: [
          `To provide core features: book tracking, virtual shelves, reading logs, ratings, reviews, and cross-device sync.`,
          `To authenticate you and secure your account.`,
          `To improve app stability, fix bugs, and understand aggregate usage through analytics.`,
          `To verify purchases handled by Google Play Billing (where applicable).`,
        ],
      },
    ],
  },
  {
    heading: "4. Third-Party Services",
    blocks: [
      {
        type: "ul",
        items: [
          {
            lead: "Google Sign-In:",
            text: `used for authentication. Google handles the sign-in flow; we receive only your basic profile (name, email, avatar).`,
          },
          {
            lead: "Book metadata APIs:",
            text: `Google Books API, Open Library API, Hardcover API, and Gutendex API. These services provide book metadata and cover art; no personal user data is sent to them.`,
          },
          {
            lead: "Amazon affiliate/referral links:",
            text: `purchase links may include affiliate parameters. Amazon handles any purchase under its own Privacy Notice.`,
          },
          {
            lead: "Google Play Billing:",
            text: `any in-app purchases are processed entirely by Google; we do not see or store card details.`,
          },
          {
            lead: "Analytics and crash reporting:",
            text: `standard aggregated analytics (e.g., Firebase/Crashlytics) for stability and performance.`,
          },
        ],
      },
    ],
  },
  {
    heading: "5. Data Retention",
    blocks: [
      {
        type: "p",
        text: `We keep your data only while your account is active. When you delete your account, your account information, reading logs, shelves, reviews, and imported data are permanently deleted from our production databases within 30 days. Encrypted backups are purged within 30-60 days. Where we are legally required to retain financial records (e.g., Play Billing receipts for tax purposes), those records are retained in compliance with law.`,
      },
    ],
  },
  {
    heading: "6. Your Rights",
    blocks: [
      {
        type: "p",
        text: `You can access, export, or correct your data in the app at any time. You may delete your account at any time via the app (Settings > Account > Delete Account) or via the web form at [https://shelf-life-112ee3ed.base44.app/delete-account](https://shelf-life-112ee3ed.base44.app/delete-account). You may contact us at [privacy@shelflifetbr.com](mailto:privacy@shelflifetbr.com) with any privacy request.`,
      },
    ],
  },
  {
    heading: "7. Children's Privacy",
    blocks: [
      {
        type: "p",
        text: `ShelfLife is intended for users aged 13 and over. We do not knowingly collect data from children under 13.`,
      },
    ],
  },
  {
    heading: "8. Changes to This Policy",
    blocks: [
      {
        type: "p",
        text: `We may update this policy from time to time; material changes will be announced in the app. The "Last Updated" date above always reflects the current version.`,
      },
    ],
  },
  {
    heading: "9. Contact",
    blocks: [
      {
        type: "p",
        text: `Questions? Email [privacy@shelflifetbr.com](mailto:privacy@shelflifetbr.com) or visit [https://shelf-life-112ee3ed.base44.app](https://shelf-life-112ee3ed.base44.app).`,
      },
    ],
  },
];