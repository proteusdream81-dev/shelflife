import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';
import { wipeAccount } from '../../shared/accountWipe.ts';

// Deleting an account, in the three shapes it is asked for: a reader signed into the app ending
// their own account, a visitor not signed in asking for a code by email, and that visitor
// answering with the code. The last two are open to anyone, which is the point of the page this
// serves, and the table between them holds only a hash. A visitor's answer never varies with
// whether the address has an account here, so this endpoint cannot be used to test who is
// registered.

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CODES_PER_HOUR = 3;
// Every deletion code the app mails in an hour, whatever address it names. The per-address cap
// stops one inbox being flooded; this stops the sender being turned into a mailer by a script that
// works through many addresses.
const MAX_CODES_PER_HOUR_APP = 30;
const MAX_ATTEMPTS = 5;

const CODE_SHAPE = /^\d{6}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = (body.action || '').toString();

    if (action === 'current') return await deleteSignedIn(base44);
    if (action === 'request') return await sendDeletionCode(base44, body);
    if (action === 'confirm') return await deleteWithCode(base44, body);

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}

// ---------- A reader ending their own account ----------

async function deleteSignedIn(base44) {
  const user = await requireUser(base44);
  if (!user) return unauthorized();

  await wipeAccount(base44, user.id);
  return Response.json({ ok: true });
}

// ---------- A visitor asking for a code ----------

const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

// The code is the only proof that the address belongs to the person asking for it, so the address
// is looked up exactly as it was registered and the code is mailed to that address. Nothing about
// the outcome leaves here: an address with no account is answered exactly like one with.
async function sendDeletionCode(base44, body) {
  const email = normaliseEmail(body.email);
  if (!EMAIL_SHAPE.test(email)) return Response.json({ ok: true });

  try {
    if (await tooManyCodes(base44, email)) return Response.json({ ok: true });
    if (await tooManyCodesAppWide(base44)) return Response.json({ ok: true });

    const found = await base44.asServiceRole.entities.User.filter({ email }, '-created_date', 2);
    if (found.length) await mailCode(base44, found[0], email);
  } catch (error) {
    // The answer is the same whether this worked or not, so a failure here is written to the log
    // and never to the response.
    console.error('[accountDeletion] code request failed', error);
  }

  return Response.json({ ok: true });
}

async function tooManyCodes(base44, email) {
  const since = new Date(Date.now() - CODE_WINDOW_MS).toISOString();
  const recent = await base44.asServiceRole.entities.AccountDeletionRequest.count({
    email,
    created_date: { $gte: since },
  });
  return recent >= MAX_CODES_PER_HOUR;
}

// Counts the codes actually issued in the last hour, across every address, and answers the same
// way a refused request does so the ceiling says nothing about who is registered here.
async function tooManyCodesAppWide(base44) {
  const since = new Date(Date.now() - CODE_WINDOW_MS).toISOString();
  const recent = await base44.asServiceRole.entities.AccountDeletionRequest.count({
    created_date: { $gte: since },
  });
  return recent >= MAX_CODES_PER_HOUR_APP;
}

async function mailCode(base44, user, email) {
  const code = sixDigitCode();
  const request = await base44.asServiceRole.entities.AccountDeletionRequest.create({
    email,
    code_hash: await hashCode(email, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    used: false,
  });

  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: email,
      template_name: 'AccountDeletionCode',
      variables: {
        first_name: String(user.full_name || '').split(' ')[0] || 'reader',
        otp_code: code,
      },
    });
  } catch (error) {
    // A code nobody received is a code nobody may use, so the request is withdrawn and the visitor
    // simply asks again. The response is unchanged either way.
    await base44.asServiceRole.entities.AccountDeletionRequest.delete(request.id).catch(() => {});
    console.error('[accountDeletion] code could not be sent', error);
  }
}

// ---------- A visitor answering with the code ----------

async function deleteWithCode(base44, body) {
  const email = normaliseEmail(body.email);
  const code = String(body.code || '').trim();
  if (!EMAIL_SHAPE.test(email) || !CODE_SHAPE.test(code)) return wrongCode();

  const recent = await base44.asServiceRole.entities.AccountDeletionRequest.filter(
    { email }, '-created_date', 5,
  );
  const waiting = recent.find(isUsable);
  if (!waiting) return wrongCode();

  if ((await hashCode(email, code)) !== waiting.code_hash) {
    // Five wrong answers spend the request, so a six-digit code cannot be worked through.
    await base44.asServiceRole.entities.AccountDeletionRequest.update(
      waiting.id,
      { attempts: Number(waiting.attempts || 0) + 1 },
    );
    return wrongCode();
  }

  await base44.asServiceRole.entities.AccountDeletionRequest.update(waiting.id, { used: true });

  const found = await base44.asServiceRole.entities.User.filter({ email }, '-created_date', 2);
  if (found.length) await wipeAccount(base44, found[0].id);

  // Those rows held this address, so they go with the account they were about.
  await base44.asServiceRole.entities.AccountDeletionRequest.deleteMany({ email }).catch(() => {});

  return Response.json({ ok: true });
}

const isUsable = (row) => !row.used
  && Number(row.attempts || 0) < MAX_ATTEMPTS
  && Date.parse(row.expires_at || '') > Date.now();

// One message for a code that is wrong, spent, or past its fifteen minutes: which of the three it
// is would say something about the address that was typed.
const wrongCode = () => Response.json(
  { error: 'That code is not correct, or it has expired. Please ask for a new one.' },
  { status: 400 },
);

// ---------- Codes ----------

// Six digits from the platform's own random source. The code is never stored: the table keeps a
// hash of it together with the address, so nothing in the database could be used to delete an
// account or to prove who asked.
function sixDigitCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function hashCode(email, code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${email}:${code}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}