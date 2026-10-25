// What the public data deletion page says, kept as data so the page stays a page. A paragraph or
// a list item may carry a link as [label](address) — the page renders it as a real link — so the
// wording here is exactly the wording a visitor, or a store reviewer, reads.

export const DATA_DELETION_HEADLINE = "Delete your ShelfLife data";

export const DATA_DELETION_INTRO =
  "You can ask us to delete your ShelfLife account and everything saved with it at any time, whether or not you still have the app installed. This page explains how to ask, what is removed, what we keep, and how long it takes. No sign-in is needed to read it or to send a request.";

export const DATA_DELETION_EMAIL = "schradercapitol@gmail.com";

export const DATA_DELETION_MAILTO = `mailto:${DATA_DELETION_EMAIL}?subject=Data%20Deletion%20Request&body=Please%20delete%20my%20ShelfLife%20account%20and%20all%20data%20linked%20to%20it.%0A%0AAccount%20email%3A%20`;

export const DATA_DELETION_SECTIONS = [
  {
    heading: "How to request deletion",
    blocks: [
      {
        type: "p",
        text: `Email [${DATA_DELETION_EMAIL}](mailto:${DATA_DELETION_EMAIL}) from the email address registered to your ShelfLife account, with the subject line "Data Deletion Request". We can only action a request sent from the account's own address, because that is how we know the account is yours.`,
      },
      {
        type: "p",
        lead: "Faster if you still have the app or a browser:",
        text: `open Settings > Account > Delete Account and confirm, or use the web form at [https://shelflifetbr.com/delete-account](https://shelflifetbr.com/delete-account). In that case your account is deleted as soon as you confirm.`,
      },
    ],
  },
  {
    heading: "What is deleted",
    blocks: [
      {
        type: "ul",
        items: [
          `Your account and profile: email address, sign-in details, display name, username, profile photo and bio.`,
          `Your books and lists: saved books, shelves, TBR lists, reading status and dates, ratings, reviews and private notes.`,
          `Your connections: follows, friend requests, shared shelves, book group memberships, and the comments you wrote.`,
          `Your preferences: stored settings such as storefront region, how covers and content warnings are shown, and notification choices.`,
        ],
      },
    ],
  },
  {
    heading: "How long it takes",
    blocks: [
      {
        type: "p",
        text: `We process deletion requests within 30 days of receiving them. Your account is deactivated when we start, so it no longer appears to anyone else, and we send a confirmation email to the account's address once everything has been deleted.`,
      },
      {
        type: "p",
        text: `Encrypted backups are purged on their normal cycle, which is within 30 to 60 days.`,
      },
    ],
  },
  {
    heading: "What is retained",
    blocks: [
      {
        type: "p",
        text: `Nothing that identifies you. Once a request is complete we hold no personal data beyond records we are legally required to keep, such as purchase receipts needed for tax and accounting. Those records are kept only as long as the law requires, are never used to contact you, and are not used to build any profile.`,
      },
    ],
  },
  {
    heading: "Want a copy of your data first?",
    blocks: [
      {
        type: "p",
        text: `You do not have to delete to see your data. Email [${DATA_DELETION_EMAIL}](mailto:${DATA_DELETION_EMAIL}) from the account's address with the subject line "Data Export Request", and we will send you a copy of your ShelfLife data before anything is removed. Ask for the copy first if you would like to keep your shelves and reviews elsewhere.`,
      },
    ],
  },
];

export const DATA_DELETION_CONTACT = {
  heading: "Questions",
  blocks: [
    {
      type: "p",
      text: `Write to [${DATA_DELETION_EMAIL}](mailto:${DATA_DELETION_EMAIL}) for anything about deletion, export or this page. More about how ShelfLife handles information is in the [Privacy Policy](https://shelflifetbr.com/privacy-policy).`,
    },
  ],
};