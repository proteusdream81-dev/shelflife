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
  const { granted, reason } = await spendCredits(db, { reader, feature, count: 1 });
  return granted ? null : (reason || READER_SPENT);
}

// The same ceiling asked for a whole run at once: how many of `count` paid calls may go ahead.
// A bulk send — an admin writing to many inboxes — is one reader asking for many calls, so the
// app's daily allowance is what bounds it, and whatever is left over is left for another day.
export async function spendCredits(db, { reader, feature, count, appOnly = false }) {
  const wanted = Math.min(500, Math.max(0, Math.floor(Number(count) || 0)));
  if (!wanted) return { granted: 0, reason: READER_SPENT };

  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const key = `credit:${feature}:${reader}`.slice(0, 200);

  try {
    const [lastHour, lastDay] = await Promise.all(appOnly
      ? [0, 0]
      : [
        db.asServiceRole.entities.RateLimitHit.count({
          actor_key: key,
          created_date: { $gte: hourAgo },
        }),
        db.asServiceRole.entities.RateLimitHit.count({
          actor_key: key,
          created_date: { $gte: dayAgo },
        }),
      ]);

    const appToday = await appSpentToday(db, dayAgo);

    const room = Math.min(
      appOnly ? wanted : CREDIT_LIMITS.readerPerHour - lastHour,
      appOnly ? wanted : CREDIT_LIMITS.readerPerDay - lastDay,
      CREDIT_LIMITS.appPerDay - appToday,
    );
    const granted = Math.max(0, Math.min(wanted, room));
    const reason = granted < wanted
      ? (appToday >= CREDIT_LIMITS.appPerDay || appToday + granted >= CREDIT_LIMITS.appPerDay
        ? APP_SPENT
        : READER_SPENT)
      : '';

    if (!granted) return { granted, reason };

    await db.asServiceRole.entities.RateLimitHit.bulkCreate(
      Array.from({ length: granted }, () => ({ actor_key: key })),
    );

    // Clearing up is a chore, not part of the answer, so it happens on a small share of calls.
    if (Math.random() < 0.05) {
      await db.asServiceRole.entities.RateLimitHit
        .deleteMany({ created_date: { $lt: new Date(Date.now() - KEEP_MS).toISOString() } })
        .catch(() => {});
    }

    return { granted, reason };
  } catch (error) {
    console.error(`[creditGuard] ${feature} cap was not applied - ${error?.message || error}`);
    return { granted: wanted, reason: '' };
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