// A ceiling on what the app can spend: every function that calls a paid Base44 integration — an
// AI lookup, an email — asks here before it spends, and is refused once the allowance is gone.
//
// Three caps stand together, so neither one account nor one busy day can run up a bill nobody
// chose:
//   - how fast one reader may spend in an hour,
//   - how much one reader may spend of one feature in a day,
//   - how much the whole app may spend in a day, across every reader and feature.
//
// The count lives in RateLimitHit, a table only the server can read or write, one row per paid
// call. The check fails open: if the table cannot be read the reader is served rather than
// blocked, and the failure is written to the log.

import { HOUR_MS } from './rateLimit.ts';

const DAY_MS = 24 * HOUR_MS;

// Rows from before yesterday's window are no longer counted, so they are cleared as calls come in.
const KEEP_MS = 2 * DAY_MS;

export const CREDIT_LIMITS = {
  readerPerHour: 8,
  readerPerDay: 20,
  appPerDay: 200,
};

export const READER_SPENT =
  'You have reached the limit for this for now. Please try again a little later.';

export const APP_SPENT =
  'ShelfLife is very busy right now. Please try again in a little while.';

// Answers the reason the call may not go ahead, or null when it may — in which case the call is
// counted before it is made, so a burst of parallel requests cannot all slip under the same cap.
export async function spendCredit(db, { reader, feature }) {
  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const key = `credit:${feature}:${reader}`.slice(0, 200);

  try {
    const [lastHour, lastDay] = await Promise.all([
      db.asServiceRole.entities.RateLimitHit.count({
        actor_key: key,
        created_date: { $gte: hourAgo },
      }),
      db.asServiceRole.entities.RateLimitHit.count({
        actor_key: key,
        created_date: { $gte: dayAgo },
      }),
    ]);

    if (lastHour >= CREDIT_LIMITS.readerPerHour) return READER_SPENT;
    if (lastDay >= CREDIT_LIMITS.readerPerDay) return READER_SPENT;

    if ((await appSpentToday(db, dayAgo)) >= CREDIT_LIMITS.appPerDay) return APP_SPENT;

    await db.asServiceRole.entities.RateLimitHit.create({ actor_key: key });

    // Clearing up is a chore, not part of the answer, so it happens on a small share of calls.
    if (Math.random() < 0.05) {
      await db.asServiceRole.entities.RateLimitHit
        .deleteMany({ created_date: { $lt: new Date(Date.now() - KEEP_MS).toISOString() } })
        .catch(() => {});
    }

    return null;
  } catch (error) {
    console.error(`[creditGuard] ${feature} cap was not applied - ${error?.message || error}`);
    return null;
  }
}

// Everything the app has spent today, whatever the feature. Only the credit rows are wanted; if
// the pattern is refused, every counted call today stands in instead — a stricter ceiling, never
// a missing one.
async function appSpentToday(db, dayAgo) {
  try {
    return await db.asServiceRole.entities.RateLimitHit.count({
      actor_key: { $regex: '^credit:' },
      created_date: { $gte: dayAgo },
    });
  } catch {
    return await db.asServiceRole.entities.RateLimitHit.count({
      created_date: { $gte: dayAgo },
    });
  }
}