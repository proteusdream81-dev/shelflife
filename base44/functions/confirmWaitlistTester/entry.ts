import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { withinGuestLimit } from '../../shared/rateLimit.ts';

const SITE_URL = 'https://shelflifetbr.com';
const PLAY_STORE_URL = 'https://play.google.com/apps/testing/com.codelustre.shelflifeapp';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));

// The answer a click on the confirmation link lands on: a finished page, because a browser
// opened from an inbox has no app loaded yet.
const page = (heading, message, status) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" /><title>${escapeHtml(heading)} — ShelfLife</title></head>
<body style="margin:0;background:#1d0c1a;color:#f7ede6;">
<main style="max-width:560px;margin:0 auto;padding:64px 24px;text-align:center;">
<p style="font-family:Georgia,serif;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#f2a93b;margin:0 0 18px;">ShelfLife</p>
<h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.2;margin:0 0 12px;">${escapeHtml(heading)}</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#c2a8b8;margin:0 0 26px;">${message}</p>
<p style="margin:0;"><a href="${SITE_URL}/beta" style="display:inline-block;background:#f2a93b;color:#291322;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;padding:13px 22px;border-radius:6px;">Open the tester steps</a></p>
<p style="font-family:Arial,sans-serif;font-size:12px;margin:26px 0 0;"><a href="${PLAY_STORE_URL}" style="color:#f2a93b;">Become a tester on Google Play</a></p>
</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// The other end of the confirmation link: the one place the tester welcome is sent from.
// Nothing here is taken from the caller except the token itself, so the welcome can only reach
// the address that was saved when the link was issued and has now been opened by its owner.
export default async function (req) {
  try {
    const token = String(new URL(req.url).searchParams.get('token') || '').trim();
    if (!token) {
      return page('That link is incomplete', 'Open the link from the email again, or sign up once more on the beta page and a fresh one follows.', 400);
    }

    const base44 = createClientFromRequest(req);

    // Anyone may open this link, so the connection is counted rather than a reader: a real click
    // goes through, while a script working through tokens is turned away before it reaches the table.
    if (!(await withinGuestLimit(base44, req, { bucket: 'confirmWaitlistTester', max: 30 }))) {
      return page('Give it a moment', 'That link has been opened a lot just now. Please try again in a little while.', 429);
    }

    // The token is a random UUID only ever written to this table, so holding it is the proof.
    const matches = await base44.asServiceRole.entities.Waitlist.filter({ confirm_token: token }, '-created_date', 1);
    const reader = matches[0];
    if (!reader) {
      return page('That link has already been used', 'A confirmation link works once. Sign up again on the beta page if you need a fresh one.', 400);
    }

    // Cleared first, so a second tap on the same link can never send a second welcome.
    await base44.asServiceRole.entities.Waitlist.update(reader.id, { confirmed: true, confirm_token: '' });

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: reader.email,
        from_name: 'ShelfLife',
        template_name: 'FoundingTesterWelcome',
        variables: { first_name: String(reader.name || '').slice(0, 40) || 'reader' },
      });
    } catch {
      // The confirmation stands, and the beta page still walks them through the same steps.
    }

    return page("You're confirmed", `The test build is on its way to ${escapeHtml(reader.email)}. It should land within a few minutes.`, 200);
  } catch (error) {
    return page('Something went wrong', 'Please open that link once more in a moment.', 500);
  }
}