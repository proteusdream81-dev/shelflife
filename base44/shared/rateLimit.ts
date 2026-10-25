// A cap on how often one signed-in reader may call a function that spends something — an AI
// credit, a book-catalogue key, a public map server, someone else's inbox. Each function asks
// before it does the work, so a loop run by one account runs into the wall instead of running
// up the app's allowance for everybody.
//
// The count lives in a table only the server can read or write, one row per accepted call.
// The check fails open: if the table cannot be read the reader is served rather than blocked,
// and the failure is written to the log.

export const HOUR_MS = 60 * 60 * 1000;

// Rows from earlier windows are no longer counted, so they are cleared out as calls come in.
const KEEP_MS = 24 * HOUR_MS;

export async function withinLimit(db, { actor, bucket, max, windowMs = HOUR_MS }) {
  const key = `${bucket}:${actor}`.slice(0, 200);
  const since = new Date(Date.now() - windowMs).toISOString();

  try {
    const used = await db.asServiceRole.entities.RateLimitHit.count({
      actor_key: key,
      created_date: { $gte: since },
    });
    if (used >= max) return false;

    await db.asServiceRole.entities.RateLimitHit.create({ actor_key: key });

    await db.asServiceRole.entities.RateLimitHit
      .deleteMany({ created_date: { $lt: new Date(Date.now() - KEEP_MS).toISOString() } })
      .catch(() => {});

    return true;
  } catch (error) {
    console.error(`[rateLimit] ${bucket} was not applied - ${error?.message || error}`);
    return true;
  }
}

export const tooMany = (message) => Response.json({ error: message }, { status: 429 });