# Google Play Store listing — ShelfLife (STORE-001)

Paste these fields into **Play Console → Grow → Store presence → Main store listing**.
Update the package name and direct store URL when the app is live.

**Developer / brand:** Codelustre · Justin Schrader  
**ABN:** 21 214 407 939  
**App name (title, max 30 chars):** `ShelfLife`  
**Package name (set in Console / AAB):** _TBD — e.g. `com.codelustre.shelflife`_  
**Default language:** English (Australia) or English (United States)

---

## Short description (max 80 characters)

```
Scan books onto beautiful shelves. Import Goodreads. Share lists with friends.
```

Character count: 78

---

## Full description (max 4000 characters)

```
ShelfLife is the book tracker that looks like your real shelf.

Scan a barcode or search a title and the book lands on a shelf worth looking at. Import your Goodreads, StoryGraph, or CSV library, keep private and shared lists, and hand a shelf to a friend.

WHAT YOU CAN DO

• Build visual shelves — To Read, Currently Reading, Read, and your own custom shelves
• Scan barcodes or search by title and author
• Import existing libraries from CSV (Goodreads, StoryGraph, and more)
• Share a shelf or a single book with a link — no account required for guests to view
• Follow readers, leave comments, and keep a reading circle
• Find libraries and bookshops near you
• Upload custom covers and keep higher-resolution art when it is available
• Rate books, add notes, and track status without paywalling the core experience

FREE CORE

Adding books, basic search, shelf tracking, and changing reading status stay free. Optional ShelfLife Plus unlocks power-user tools when you want them.

AFFILIATE DISCLOSURE

ShelfLife may show links to bookshops, including Amazon. As an Amazon Associate, ShelfLife earns from qualifying purchases. You never pay more because of an affiliate tag.

OPERATOR

ShelfLife is operated by Justin Schrader (Codelustre), ABN 21 214 407 939.

PRIVACY & SUPPORT

• Privacy Policy: https://shelflifetbr.com/privacy
• Terms of Service: https://shelflifetbr.com/terms
• Data deletion: https://shelflifetbr.com/data-deletion
• Support: support@shelflifetbr.com

Intended for readers aged 13 and over.
```

---

## App category & tags

| Field | Value |
| --- | --- |
| **Application type** | Application |
| **Category** | Books & Reference (or Lifestyle if preferred) |
| **Tags** | books, reading, tbr, bookshelf, goodreads, library |

---

## Contact & legal (Console)

| Field | Value |
| --- | --- |
| **Email** | support@shelflifetbr.com _(or your Play developer email)_ |
| **Website** | https://shelflifetbr.com |
| **Privacy policy** | https://shelflifetbr.com/privacy |
| **Terms** | https://shelflifetbr.com/terms |
| **ABN** | 21 214 407 939 |
| **Developer name** | Justin Schrader / Codelustre |

Use this ABN in Play Console developer / payments identity fields where an Australian Business Number is requested. Do not invent additional numbers.

---

## Graphics checklist

| Asset | Spec | Source in this repo |
| --- | --- | --- |
| **App icon** | 512 × 512 PNG, 32-bit | `public/icon-512.png` |
| **Feature graphic** | 1024 × 500 PNG/JPEG | Create in design tool from brand colours `#1d0c1a` / `#f2a93b`; include wordmark “ShelfLife” + tagline “Your reading life” |
| **Phone screenshots** | min 2, up to 8; 16:9 or 9:16 | Capture from beta build: Home shelves, Add book / scan, Shared shelf, Settings |
| **7-inch tablet** | optional but recommended | Same flows on a tablet emulator |
| **10-inch tablet** | optional | Same |

**Brand colours**
- Background: `#1d0c1a`
- Accent / gold: `#f2a93b`
- Text: light rose / cream (`#f7ede6`)

**Icon note:** Use `icon-512.png` for the store icon. Do not upload a generic book glyph; that is what STORE-002 fixed in the website header.

---

## Content rating & policies

Complete in Play Console (not in this file):

1. Content rating questionnaire (IARC)
2. Target audience and content (age 13+)
3. Data safety form (account data, library data, approximate location for Near Me)
4. Ads declaration (none at launch unless you add ads)
5. News / COVID / financial features: none

---

## In-app products (when Plus ships)

| Product ID (suggested) | Type | Price (AUD guide) |
| --- | --- | --- |
| `plus_monthly` | Subscription | $3.99 / month |
| `plus_yearly` | Subscription | $29.99 / year |
| `plus_lifetime` | One-time | $59.99 |

Configure only after Billing Library is integrated (Phase 2).

---

## Release notes (template)

```
What's new
• Bug fixes and stability improvements
• Shared shelves and comments load more reliably
• Cover uploads and higher-resolution covers improved
• Website and app brand mark aligned
```

---

## When the listing is live

1. Copy the direct URL, e.g.  
   `https://play.google.com/store/apps/details?id=YOUR.PACKAGE.NAME`
2. Replace the search placeholder in:
   - `src/lib/reviewPrompt.js` → `PLAY_STORE_URL`
   - `base44/functions/joinWaitlist/entry.ts`
   - `public/invite.html` / `index.html` noscript links if still hardcoded
3. Publish a new web build so in-app “Get it on Google Play” buttons open the real listing.

Until then, search links remain intentional placeholders so users are not sent to unrelated “ShelfLife” apps on Play.
