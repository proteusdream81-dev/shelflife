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

const GUEST_SALT = 'shelflife-guest';

// The address a request came from. Only the platform's own edge header, then the address a proxy
// recorded, then the LAST hop of the chain are believed: the first X-Forwarded-For entry is
// whatever the caller typed, so keying a limit on it lets every request pick its own allowance.
function connectionAddress(req) {
  const edge = String(req.headers.get('cf-connecting-ip') || '').trim();
  if (edge) return edge;
  const real = String(req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  const hops = String(req.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length ? hops[hops.length - 1] : '';
}

// A caller with no account has no id to count, so the connection is counted instead: the address
// the request came from, folded with a fixed salt so no one's address is ever stored.
async function guestActor(req) {
  const address = connectionAddress(req);
  if (!address) return '';
  const bytes = new TextEncoder().encode(`${GUEST_SALT}:${address}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `guest:${hex}`;
}

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

// The same cap for a function a stranger may call — a share link being opened, a confirmation
// link being clicked. A request carrying no address at all is let through, so a real visitor is
// never turned away by a missing header.
export async function withinGuestLimit(db, req, { bucket, max, windowMs = HOUR_MS }) {
  const actor = await guestActor(req);
  if (!actor) return true;
  return await withinLimit(db, { actor, bucket, max, windowMs });
}

export const tooMany = (message) => Response.json({ error: message }, { status: 429 });