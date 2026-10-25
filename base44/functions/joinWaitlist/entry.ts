import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const APP_URL = 'https://shelflifetbr.com';
const PLAY_STORE_URL = 'https://play.google.com/store/search?q=ShelfLife%20reading%20list&c=apps';
// One connection may add five addresses an hour. That is a person sharing the link with a
// friend; a thousand is a script filling the list.
const SIGNUPS_PER_HOUR = 5;
// A ceiling on the whole list, whatever address a caller claims for itself: rotating a header
// must never turn five signups a connection into an unlimited number across many.
const SIGNUPS_PER_HOUR_TOTAL = 150;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const CLIENT_KEY_SALT = 'shelflife-waitlist';
// A tester who has lost the confirmation mail can ask for another, but not more than once an
// hour: one address is never written to over and over by whoever happened to type it in.
const RESEND_AFTER_MS = 60 * 60 * 1000;
// One address may be asked to confirm three times in a rolling day and no more. That cap is
// counted on the address itself, not on the connection, which any caller can claim for itself, so
// a stranger who types someone else's address into the public form can never flood that inbox.
const SENDS_PER_ADDRESS = 3;
const SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
// Every confirmation mail the app sends in an hour, whatever address it names. A script that
// invents a fresh address per request still meets a ceiling, so the sender is never a bulk mailer.
const SENDS_PER_HOUR_APP = 60;
const FALLBACK_ORIGIN = 'https://meek-shelflife-reader-hub.base44.app';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));

// The name is written into an email, so only what a name can actually contain is kept: letters
// and the punctuation names use, never markup, links or control characters.
const cleanName = (value) =>
  String(value || '')
    .replace(/[^\p{L}\p{M}\s'’.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

// Where the confirmation link points. The platform's own app origin when the request carries it,
// and only when it really is one of this app's https hosts, so a crafted header can never put a
// stranger's address into a mail sent in the app's name.
function appOrigin(req) {
  const raw = String(req.headers.get('x-base44-app-url') || '').trim().replace(/\/+$/, '');
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const ours = host.endsWith('.base44.app') || host === 'shelflifetbr.com' || host === 'www.shelflifetbr.com';
    if (url.protocol === 'https:' && ours) return url.origin;
  } catch {
    // Falls through to the app's own published origin.
  }
  return FALLBACK_ORIGIN;
}

// The page a plain form post lands on. A browser with scripts blocked can't render the app, so
// the answer has to be a finished page rather than JSON.
const htmlPage = (heading, message, status) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" /><title>${escapeHtml(heading)} — ShelfLife</title></head>
<body style="margin:0;background:#1d0c1a;color:#f7ede6;">
<main style="max-width:560px;margin:0 auto;padding:64px 24px;text-align:center;">
<p style="font-family:Georgia,serif;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#f2a93b;margin:0 0 18px;">ShelfLife</p>
<h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.2;margin:0 0 12px;">${escapeHtml(heading)}</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#c2a8b8;margin:0 0 26px;">${message}</p>
<p style="margin:0;"><a href="${APP_URL}" style="display:inline-block;background:#f2a93b;color:#291322;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;padding:13px 22px;border-radius:6px;">Back to ShelfLife</a></p>
<p style="font-family:Arial,sans-serif;font-size:12px;margin:26px 0 0;"><a href="${PLAY_STORE_URL}" style="color:#f2a93b;">Get it on Google Play</a></p>
</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// Where the request actually came from. Only the platform's own edge header, then the address a
// proxy recorded, then the LAST hop of the chain are believed: the first X-Forwarded-For entry is
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
  // The last hop is the one the closest proxy appended, not the one the caller claimed.
  return hops.length ? hops[hops.length - 1] : '';
}

// The address a request came from, folded with a fixed salt into something stable and
// unreadable, so signups can be counted per connection without keeping anyone's IP.
async function clientKey(req) {
  const address = connectionAddress(req);
  if (!address) return '';
  const bytes = new TextEncoder().encode(`${CLIENT_KEY_SALT}:${address}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Counts this signup against the connection it came from, and says whether it may go ahead.
// The count is kept in a table only the server can read or write.
async function withinSignupLimit(base44, visitorKey) {
  const recent = await base44.asServiceRole.entities.WaitlistAttempt.filter(
    { visitor_key: visitorKey }, '-created_date', SIGNUPS_PER_HOUR,
  );
  if (recent.length >= SIGNUPS_PER_HOUR) {
    const oldest = Date.parse(recent[recent.length - 1]?.created_date || '');
    if (Number.isFinite(oldest) && Date.now() - oldest < SIGNUP_WINDOW_MS) return false;
  }
  await base44.asServiceRole.entities.WaitlistAttempt.create({ visitor_key: visitorKey });
  return true;
}

// Counts the whole list's new signups in the same window, so a caller that invents a fresh
// address for every request still runs into a limit. Counting the addresses actually saved
// means a row is never written just to be refused.
async function withinTotalLimit(base44) {
  const since = new Date(Date.now() - SIGNUP_WINDOW_MS).toISOString();
  const recent = await base44.asServiceRole.entities.Waitlist.filter(
    { created_date: { $gte: since } }, '-created_date', SIGNUPS_PER_HOUR_TOTAL,
  );
  return recent.length < SIGNUPS_PER_HOUR_TOTAL;
}

// Counts the confirmation mails actually sent in the last hour, so a caller inventing a new
// address for every request can still only cause so much mail from this app's sender.
async function withinMailLimit(base44) {
  const since = new Date(Date.now() - SIGNUP_WINDOW_MS).toISOString();
  const recent = await base44.asServiceRole.entities.Waitlist.filter(
    { confirm_last_sent_at: { $gte: since } }, '-created_date', SENDS_PER_HOUR_APP,
  );
  return recent.length < SENDS_PER_HOUR_APP;
}

// Whether this address may be written to again at all: a rolling day, counted per address.
function addressMayBeMailed(record) {
  if (!record) return true;
  const sentAt = Date.parse(record.confirm_last_sent_at || '');
  const windowOpen = Number.isFinite(sentAt) && Date.now() - sentAt <= SEND_WINDOW_MS;
  const sent = Number(record.confirm_sends || 0);
  return !windowOpen || sent < SENDS_PER_ADDRESS;
}

// The count to store beside a mail: a day-old count starts again at one.
function nextSendCount(record) {
  const sentAt = Date.parse(record?.confirm_last_sent_at || '');
  const windowOpen = Number.isFinite(sentAt) && Date.now() - sentAt <= SEND_WINDOW_MS;
  return (windowOpen ? Number(record?.confirm_sends || 0) : 0) + 1;
}

// The answer a limited signup gets, in the shape of the request that made it.
const tooManySignups = (fromForm) => (fromForm
  ? htmlPage(
    'Give it a moment',
    'A few signups came in just now. Please try again in about an hour.',
    429,
  )
  : Response.json(
    { error: 'Too many signups just now — please try again in about an hour.' },
    { status: 429 },
  ));

// The public waitlist endpoint: anyone may add themselves, nobody may read the list back.
// Native form posts and JSON calls both land here, and a duplicate address is simply success.
export default async function(req) {
  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    const fromForm = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');

    let payload = {};
    if (fromForm) {
      const params = new URLSearchParams(await req.text());
      payload = {
        email: params.get('email'),
        name: params.get('name'),
        source: params.get('source'),
        // An unticked native checkbox sends nothing at all, so absence means "no".
        founding_tester_consent: params.get('founding_tester_consent'),
      };
    } else {
      payload = await req.json().catch(() => ({}));
    }

    const email = String(payload.email || '').trim().toLowerCase().slice(0, 254);
    const name = cleanName(payload.name);
    const source = String(payload.source || 'landing').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'landing';
    // A checkbox arrives as "on" from a plain form post and as true from the in-app call.
    const consentValue = String(payload.founding_tester_consent ?? '').trim().toLowerCase();
    const foundingTesterConsent = ['on', 'true', 'yes', '1'].includes(consentValue);

    if (!EMAIL_PATTERN.test(email)) {
      if (fromForm) return htmlPage('That email looks off', 'Head back, check the address and try again.', 400);
      return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Whatever a caller says about its own address, the list can only grow so much in an hour,
    // so inventing a new one per request buys a spammer nothing.
    if (!(await withinTotalLimit(base44))) return tooManySignups(fromForm);

    // A signup with no address to count is let through rather than refused, so a real reader
    // is never turned away by a missing header.
    const visitorKey = await clientKey(req);
    if (visitorKey && !(await withinSignupLimit(base44, visitorKey))) {
      return tooManySignups(fromForm);
    }

    // The form belongs to strangers, so the service role is the only client allowed to write;
    // the entity's own rules stay closed to every reader.
    const existing = await base44.asServiceRole.entities.Waitlist.filter({ email });
    // An address typed into a public form proves nothing on its own, so the tester welcome is never
    // sent from here. A one-time link goes to that address instead, and the welcome follows only
    // from the click in confirmWaitlistTester, to the address on the record it unlocks.
    // Both ceilings are answered before a token is made, so no mail is ever sent on the way to
    // finding out it shouldn't be: three mails a day to any one address, and the app's own hourly
    // ceiling across all addresses.
    const mailAllowed = foundingTesterConsent
      && addressMayBeMailed(existing[0])
      && (await withinMailLimit(base44));

    let confirmToken = '';
    if (!existing.length) {
      confirmToken = mailAllowed ? crypto.randomUUID() : '';
      await base44.asServiceRole.entities.Waitlist.create({
        email,
        name,
        source,
        founding_tester_consent: foundingTesterConsent,
        confirmed: false,
        confirm_token: confirmToken,
        confirm_sends: confirmToken ? 1 : 0,
        confirm_last_sent_at: confirmToken ? new Date().toISOString() : '',
      });
    } else if (mailAllowed && !existing[0].confirmed) {
      // A returning reader who now volunteers for testing gets a fresh link, and one whose link
      // was lost can ask again, but never more than once an hour for any one address.
      const lastWrite = Date.parse(existing[0].updated_date || '');
      const stale = !Number.isFinite(lastWrite) || Date.now() - lastWrite > RESEND_AFTER_MS;
      if (!existing[0].founding_tester_consent || stale) {
        confirmToken = crypto.randomUUID();
        await base44.asServiceRole.entities.Waitlist.update(existing[0].id, {
          founding_tester_consent: true,
          confirmed: false,
          confirm_token: confirmToken,
          confirm_sends: nextSendCount(existing[0]),
          confirm_last_sent_at: new Date().toISOString(),
        });
      }
    }

    if (confirmToken) {
      // The mail carries a link and nothing the sender chose, so a stranger typing someone else's
      // address can only ever cause a confirmation request, never a "you're in" that isn't theirs.
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          from_name: 'ShelfLife',
          template_name: 'ConfirmTesterEmail',
          variables: {
            first_name: name || 'reader',
            confirm_url: `${appOrigin(req)}/functions/confirmWaitlistTester?token=${confirmToken}`,
          },
        });
      } catch {
        // The signup stands, and the beta page still walks them through the same steps.
      }
    }

    const already = existing.length > 0;

    if (fromForm) {
      const safeEmail = `<strong>${escapeHtml(email)}</strong>`;
      return htmlPage(
        already ? "You're already on the list" : "You're on the list",
        already
          ? `We already have ${safeEmail} saved, so there is nothing else to do.${foundingTesterConsent ? ' If you are testing, check your inbox for the confirmation link.' : ''}`
          : `We saved ${safeEmail}.${confirmToken ? ' One tap left: open the confirmation link we just sent, and the test build follows.' : ' We will email the moment ShelfLife lands on Google Play.'}`,
        200,
      );
    }

    return Response.json({ ok: true, alreadyOnList: already, needsConfirmation: Boolean(confirmToken) });
  } catch (error) {
    return Response.json({ error: 'We could not save that just now. Please try again.' }, { status: 500 });
  }
}