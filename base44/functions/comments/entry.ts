import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { waitUntil } from 'base44:runtime';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';
import { isBlocked } from '../../shared/blocks.ts';
import {
  bookForViewer, outOfReach, shareForToken, shelfForViewer,
} from '../../shared/sharedAccess.ts';

// The discussion on a shared shelf or a shared book. Every thread is read and written here, so
// who may see it is decided on the server from the shelf or book itself: a share link opens it
// for whoever holds the link, a shelf shared with a circle opens it for that circle, and a block
// in either direction closes it. Comments and reports are only ever written with the service
// role, because the entity's own rules are closed to readers.
const LINK = 'https://shelflifetbr.com';
const MAX_BODY = 2000;
const COMMENTS_PER_HOUR = 30;
const REPORTS_PER_HOUR = 20;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    if (action === 'list') return await listThread(base44, body, await requireUser(base44));

    const user = await requireUser(base44);
    if (!user) return unauthorized();

    if (action === 'create') return await addComment(base44, body, user);
    if (action === 'remove') return await removeComment(base44, body, user);
    if (action === 'report') return await reportComment(base44, body, user);

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}

// The shelf or book a request is about, resolved to something the caller is allowed to see.
// A share token is its own permission; a shelf or book id is only opened through the reading
// circle rules in sharedAccess.
async function resolveTarget(base44, body, viewerId) {
  const token = String(body.token || '').trim();
  if (token) return await shareForToken(base44, token);

  const shelfId = String(body.shelf_id || '').trim();
  if (shelfId) return await shelfForViewer(base44, shelfId, viewerId);

  const bookId = String(body.book_id || '').trim();
  if (bookId) return await bookForViewer(base44, bookId, viewerId);

  return null;
}

async function listThread(base44, body, user) {
  const target = await resolveTarget(base44, body, user?.id);
  if (!target) return Response.json({ comments: [], can_post: false });

  const rows = await base44.asServiceRole.entities.Comment.filter(
    { target_kind: target.kind, target_id: target.item.id }, '-created_date', 200,
  );

  // A blocked reader's words are simply not there, for the thread's owner and for the caller.
  const out = await outOfReach(base44, target.owner_id, user?.id);
  const viewer = user || null;
  const comments = rows
    .filter((row) => !out.has(row.author_id))
    .map((row) => ({
      id: row.id,
      body: row.body || '',
      author_id: row.author_id || '',
      author_name: row.author_name || 'A reader',
      parent_id: row.parent_id || '',
      created_date: row.created_date,
      mine: Boolean(viewer) && row.author_id === viewer.id,
      mine_to_delete: Boolean(viewer)
        && (row.author_id === viewer.id || target.owner_id === viewer.id),
    }));

  const canPost = Boolean(viewer) && !(await isBlocked(base44, viewer.id, target.owner_id));
  return Response.json({ can_post: canPost, owner_id: target.owner_id, comments });
}

async function addComment(base44, body, user) {
  const text = String(body.body || '').replace(/\u0000/g, '').trim().slice(0, MAX_BODY);
  if (!text) return Response.json({ error: 'Write a comment first.' }, { status: 400 });

  const target = await resolveTarget(base44, body, user.id);
  if (!target) return Response.json({ error: 'That discussion is not open to you.' }, { status: 403 });

  if (await isBlocked(base44, user.id, target.owner_id)) {
    return Response.json({ error: 'That discussion is not open to you.' }, { status: 403 });
  }

  if (!(await withinLimit(base44, user.id))) {
    return Response.json(
      { error: 'That is a lot of comments in one go. Please try again in a while.' },
      { status: 429 },
    );
  }

  // A reply only ever answers a comment on this same thread, so one cannot be used to reach
  // into a different shelf's conversation.
  const parentId = String(body.parent_id || '').trim();
  let parent = null;
  if (parentId) {
    parent = await base44.asServiceRole.entities.Comment.get(parentId).catch(() => null);
    if (!parent || parent.target_id !== target.item.id || parent.target_kind !== target.kind) {
      return Response.json({ error: 'That comment is no longer here.' }, { status: 404 });
    }
  }

  const row = await base44.asServiceRole.entities.Comment.create({
    target_kind: target.kind,
    target_id: target.item.id,
    owner_id: target.owner_id,
    body: text,
    author_id: user.id,
    author_name: user.full_name || '',
    parent_id: parent ? parent.id : '',
  });

  // The owner hears about it in the background: a comment that has been saved must never fail
  // because a notification could not be sent.
  if (target.owner_id !== user.id) waitUntil(notifyOwner(base44, target, row, user));

  return Response.json({ ok: true, id: row.id });
}

async function withinLimit(base44, authorId) {
  const recent = await base44.asServiceRole.entities.Comment.filter(
    { author_id: authorId }, '-created_date', COMMENTS_PER_HOUR,
  );
  if (recent.length < COMMENTS_PER_HOUR) return true;
  const oldest = Date.parse(recent[recent.length - 1]?.created_date || '');
  return !Number.isFinite(oldest) || Date.now() - oldest >= 60 * 60 * 1000;
}

// One email to the reader whose shelf was commented on, and only ever to an app user.
async function notifyOwner(base44, target, comment, author) {
  try {
    const owner = target.owner;
    if (!owner?.email) return;

    const name = target.kind === 'shelf'
      ? (target.item.name || 'your shelf')
      : (target.item.title || 'your book');
    const token = String(target.item.share_token || '');
    const first = String(owner.full_name || '').trim().split(' ')[0] || 'there';

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: owner.email,
      template_name: 'ShelfComment',
      variables: {
        owner_name: first,
        commenter_name: author.full_name || 'A reader',
        shelf_name: name,
        comment: comment.body.slice(0, 400),
        link: token ? `${LINK}/share/${token}` : LINK,
      },
    });
  } catch (error) {
    console.log('[comments] notification skipped:', error?.message || error);
  }
}

// The author's own comment, or anything on a thread the caller owns. A block is no defence
// here: an owner can always clear their own shelf.
async function removeComment(base44, body, user) {
  const id = String(body.comment_id || '').trim();
  if (!id) return Response.json({ error: 'comment_id is required' }, { status: 400 });

  const row = await base44.asServiceRole.entities.Comment.get(id).catch(() => null);
  if (!row) return Response.json({ ok: true });

  if (row.author_id !== user.id && row.owner_id !== user.id) {
    return Response.json({ error: 'That comment is not yours to remove.' }, { status: 403 });
  }

  const replies = await base44.asServiceRole.entities.Comment.filter(
    { parent_id: id }, '-created_date', 100,
  );
  for (const reply of replies) await base44.asServiceRole.entities.Comment.delete(reply.id);
  await base44.asServiceRole.entities.Comment.delete(id);

  return Response.json({ ok: true });
}

// A flagged comment, kept for an admin to judge even if the comment is removed in the meantime.
async function reportComment(base44, body, user) {
  const id = String(body.comment_id || '').trim();
  if (!id) return Response.json({ error: 'comment_id is required' }, { status: 400 });

  const row = await base44.asServiceRole.entities.Comment.get(id).catch(() => null);
  if (!row) return Response.json({ error: 'That comment is no longer here.' }, { status: 404 });
  if (row.author_id === user.id) return Response.json({ ok: true });

  const recent = await base44.asServiceRole.entities.Report.filter(
    { reporter_id: user.id }, '-created_date', REPORTS_PER_HOUR,
  );
  if (recent.length >= REPORTS_PER_HOUR) {
    const oldest = Date.parse(recent[recent.length - 1]?.created_date || '');
    if (Number.isFinite(oldest) && Date.now() - oldest < 60 * 60 * 1000) {
      return Response.json({ error: 'You have flagged a lot just now. Please try again later.' }, { status: 429 });
    }
  }

  const already = await base44.asServiceRole.entities.Report.filter(
    { comment_id: id, reporter_id: user.id }, '-created_date', 5,
  );
  if (!already.length) {
    await base44.asServiceRole.entities.Report.create({
      kind: 'comment',
      comment_id: id,
      target_kind: row.target_kind,
      target_id: row.target_id,
      author_id: row.author_id,
      author_name: row.author_name || '',
      reporter_id: user.id,
      reporter_name: user.full_name || '',
      reason: String(body.reason || 'Reported from a comment thread').slice(0, 500),
      excerpt: String(row.body || '').slice(0, 400),
    });
  }

  return Response.json({ ok: true });
}