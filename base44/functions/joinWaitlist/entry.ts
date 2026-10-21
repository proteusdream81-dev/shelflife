import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const APP_URL = 'https://shelflifetbr.com';
const PLAY_STORE_URL = 'https://play.google.com/store/search?q=ShelfLife%20reading%20list&c=apps';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));

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
    const name = String(payload.name || '').trim().slice(0, 80);
    const source = String(payload.source || 'landing').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'landing';
    // A checkbox arrives as "on" from a plain form post and as true from the in-app call.
    const consentValue = String(payload.founding_tester_consent ?? '').trim().toLowerCase();
    const foundingTesterConsent = ['on', 'true', 'yes', '1'].includes(consentValue);

    if (!EMAIL_PATTERN.test(email)) {
      if (fromForm) return htmlPage('That email looks off', 'Head back, check the address and try again.', 400);
      return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    // The form belongs to strangers, so the service role is the only client allowed to write;
    // the entity's own rules stay closed to every reader.
    const existing = await base44.asServiceRole.entities.Waitlist.filter({ email });
    if (!existing.length) {
      await base44.asServiceRole.entities.Waitlist.create({
        email,
        name,
        source,
        founding_tester_consent: foundingTesterConsent,
      });
    } else if (foundingTesterConsent && !existing[0].founding_tester_consent) {
      // A returning reader who has now volunteered for testing is recorded as such.
      await base44.asServiceRole.entities.Waitlist.update(existing[0].id, { founding_tester_consent: true });
    }

    const already = existing.length > 0;

    if (fromForm) {
      const safeEmail = `<strong>${escapeHtml(email)}</strong>`;
      return htmlPage(
        already ? "You're already on the list" : "You're on the list",
        already
          ? `We already have ${safeEmail} saved, so there is nothing else to do.`
          : `We saved ${safeEmail} and will email the moment ShelfLife lands on Google Play.`,
        200,
      );
    }

    return Response.json({ ok: true, alreadyOnList: already });
  } catch (error) {
    return Response.json({ error: 'We could not save that just now. Please try again.' }, { status: 500 });
  }
}