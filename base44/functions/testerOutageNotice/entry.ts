import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { spendCredits } from '../../shared/creditGuard.ts';

// One-off notice to the readers currently testing ShelfLife, explaining that the app is down for
// a technical problem. Admin only: it writes to other people's inboxes, so no reader may call it.
// A dry run reports who would be written to and sends nothing.
const MAX_RECIPIENTS = 500;
const BATCH = 6;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const readers = await base44.asServiceRole.entities.User.list('-created_date', MAX_RECIPIENTS);
    const recipients = readers.filter((reader) => reader?.email).slice(0, MAX_RECIPIENTS);

    if (dryRun) {
      return Response.json({ dryRun: true, wouldSendTo: recipients.length });
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let note = '';

    // Six at a time: one await per reader would run past the worker's connection limit. Before
    // each batch the app's credit allowance says how much of it may go out, so a notice to
    // hundreds of inboxes can never spend past the day's budget — the rest wait for another day.
    for (let start = 0; start < recipients.length; start += BATCH) {
      const batch = recipients.slice(start, start + BATCH);
      const { granted, reason } = await spendCredits(base44, {
        reader: user.id,
        feature: 'outageNotice',
        count: batch.length,
        appOnly: true,
      });

      if (!granted) {
        skipped = recipients.length - start;
        note = reason;
        break;
      }

      const results = await Promise.allSettled(batch.slice(0, granted).map((reader) => base44.asServiceRole.integrations.Core.SendEmail({
        to: reader.email,
        from_name: 'ShelfLife',
        template_name: 'TesterOutageNotice',
        variables: { first_name: String(reader.full_name || '').split(' ')[0].slice(0, 40) || 'reader' },
      })));
      results.forEach((result) => {
        if (result.status === 'fulfilled') sent += 1;
        else failed += 1;
      });

      // Part of this batch was refused, so everything after it will be too.
      if (granted < batch.length) {
        skipped = recipients.length - start - granted;
        note = reason;
        break;
      }
    }

    return Response.json({ sent, failed, skipped, total: recipients.length, note });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}