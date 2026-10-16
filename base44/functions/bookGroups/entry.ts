import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';
import { isBlocked } from '../../shared/blocks.ts';

const MAX_MEMBERS = 50;

const memberIds = (group) =>
  Array.from(new Set((Array.isArray(group.member_ids) ? group.member_ids : []).map(String))).slice(0, MAX_MEMBERS);

const blockedIds = (group) =>
  Array.from(new Set((Array.isArray(group.blocked_ids) ? group.blocked_ids : []).map(String))).slice(0, MAX_MEMBERS);

// A private group is for its owner and the readers who accepted an invite; a public one
// is open to any signed-in reader.
const maySee = (group, userId) =>
  !group.is_private || group.created_by_id === userId || memberIds(group).includes(userId);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'members');

    // Answering an invite needs no access to the group: the invite is addressed to
    // this reader by id, and that is the whole permission.
    if (action === 'accept' || action === 'decline') return respondToInvite(base44, user, body, action);

    // Leaving needs no access to the group either: this reader's own membership is the
    // whole permission, and their own id is the only thing written.
    if (action === 'leave') return leaveGroup(base44, user, body);

    // Joining a club from the open list is this reader's own decision, so it needs no
    // invite — a private club stays invite only, and a reader the owner removed stays out.
    if (action === 'join') return joinGroup(base44, user, body);

    const groupId = String(body.group_id || '').trim();
    if (!groupId) return Response.json({ error: 'A group is required' }, { status: 400 });

    // The caller's own token reads the group, so the group's rules decide what exists
    // for them: a private group someone else runs is simply not found.
    const group = await base44.entities.BookGroup.get(groupId).catch(() => null);
    if (!group) return Response.json({ error: 'Group not found' }, { status: 404 });
    if (!maySee(group, user.id)) return Response.json({ error: 'This group is private' }, { status: 403 });

    if (action === 'members') return Response.json(await roster(base44, group));

    if (action === 'close') {
      if (group.created_by_id !== user.id) {
        return Response.json({ error: 'Only the group owner can close this group' }, { status: 403 });
      }
      // The group and its invites go together: the chat is keyed by this record, so
      // closing it takes the room out of reach for everyone.
      await base44.entities.BookGroup.delete(group.id);
      await base44.asServiceRole.entities.GroupInvite.deleteMany({ group_id: group.id });
      return Response.json({ ok: true });
    }

    if (action !== 'invite' && action !== 'remove') {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    if (group.created_by_id !== user.id) {
      return Response.json({ error: 'Only the group owner can manage the guest list' }, { status: 403 });
    }

    const targetId = String(body.user_id || '').trim();
    if (!targetId || targetId === user.id) return Response.json({ error: 'Pick a reader' }, { status: 400 });

    const current = memberIds(group);

    if (action === 'invite') {
      if (current.includes(targetId)) {
        return Response.json({ error: 'They are already in this group' }, { status: 400 });
      }
      if (current.length >= MAX_MEMBERS) {
        return Response.json({ error: `A group can hold up to ${MAX_MEMBERS} readers` }, { status: 400 });
      }
      const target = await base44.asServiceRole.entities.User.get(targetId).catch(() => null);
      if (!target) return Response.json({ error: 'That reader no longer exists' }, { status: 404 });

      // An invite is a message from the owner, so a block in either direction stops it.
      if (await isBlocked(base44, user.id, targetId)) {
        return Response.json({ error: 'That reader cannot be invited' }, { status: 403 });
      }

      // Inviting a reader the owner removed before is the owner asking them back.
      if (blockedIds(group).includes(targetId)) {
        await base44.entities.BookGroup.update(group.id, {
          blocked_ids: blockedIds(group).filter((id) => id !== targetId),
        });
      }

      // An invite is a request the reader answers: sending one never adds them to the
      // group, and the guest list only moves when they accept.
      const sent = await base44.asServiceRole.entities.GroupInvite.filter({ group_id: group.id, invitee_id: targetId });
      if ((sent || []).some((invite) => invite.status === 'pending')) {
        return Response.json(await roster(base44, group));
      }

      const fields = {
        group_id: group.id,
        group_name: group.name,
        inviter_id: user.id,
        inviter_name: user.full_name || 'A reader',
        invitee_id: targetId,
        invitee_name: target.full_name || 'Reader',
        status: 'pending',
      };
      const previous = (sent || [])[0];
      if (previous) await base44.asServiceRole.entities.GroupInvite.update(previous.id, fields);
      else await base44.asServiceRole.entities.GroupInvite.create(fields);

      return Response.json(await roster(base44, group));
    }

    // Removing a reader takes them off the guest list and keeps them out of the room:
    // a private group loses them as a member, a public one only as a guest. Either way
    // an invite still waiting on them is withdrawn with it.
    await base44.entities.BookGroup.update(group.id, {
      member_ids: current.filter((id) => id !== targetId),
      blocked_ids: Array.from(new Set([...blockedIds(group), targetId])).slice(0, MAX_MEMBERS),
    });
    await base44.asServiceRole.entities.GroupInvite.deleteMany({ group_id: group.id, invitee_id: targetId });
    return Response.json(await roster(base44, group));
  } catch (error) {
    return serverError(error);
  }
}

async function respondToInvite(base44, user, body, action) {
  const inviteId = String(body.invite_id || '').trim();
  if (!inviteId) return Response.json({ error: 'An invite is required' }, { status: 400 });

  const invite = await base44.asServiceRole.entities.GroupInvite.get(inviteId).catch(() => null);
  if (!invite || invite.invitee_id !== user.id) {
    return Response.json({ error: 'That invite is not yours' }, { status: 404 });
  }

  if (action === 'decline') {
    await base44.asServiceRole.entities.GroupInvite.update(invite.id, { status: 'declined' });
    return Response.json({ ok: true });
  }

  const group = await base44.asServiceRole.entities.BookGroup.get(invite.group_id).catch(() => null);
  if (!group) {
    await base44.asServiceRole.entities.GroupInvite.update(invite.id, { status: 'declined' });
    return Response.json({ error: 'That group is no longer available' }, { status: 404 });
  }

  // Accepting is the reader joining, so this is the one place a member list is written
  // for somebody else's account — the invite addressed to them is the proof.
  const next = Array.from(new Set([...memberIds(group), user.id])).slice(0, MAX_MEMBERS);
  await base44.asServiceRole.entities.BookGroup.update(group.id, { member_ids: next });
  await base44.asServiceRole.entities.GroupInvite.update(invite.id, { status: 'accepted' });
  return Response.json({ group: { id: group.id, name: group.name } });
}

// A reader leaving a group they did not create: their own membership is the permission,
// so nothing else on the group is touched and an invite of theirs is withdrawn with it.
async function leaveGroup(base44, user, body) {
  const groupId = String(body.group_id || '').trim();
  if (!groupId) return Response.json({ error: 'A group is required' }, { status: 400 });

  // The caller's own token reads the group, so a group they were never part of is not found.
  const group = await base44.entities.BookGroup.get(groupId).catch(() => null);
  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 });
  if (group.created_by_id === user.id) {
    return Response.json({ error: 'You own this group — close it instead of leaving it' }, { status: 400 });
  }

  await base44.asServiceRole.entities.GroupInvite.deleteMany({ group_id: group.id, invitee_id: user.id });
  const current = memberIds(group);
  if (current.includes(user.id)) {
    await base44.asServiceRole.entities.BookGroup.update(group.id, {
      member_ids: current.filter((id) => id !== user.id),
    });
  }
  return Response.json({ ok: true });
}

// Joining a public club. The club's own rules decide whether it exists for this reader, so
// a private club someone else runs is simply not found — and being asked back after the
// owner removed them is the owner's call, never theirs.
async function joinGroup(base44, user, body) {
  const groupId = String(body.group_id || '').trim();
  if (!groupId) return Response.json({ error: 'A group is required' }, { status: 400 });

  const group = await base44.entities.BookGroup.get(groupId).catch(() => null);
  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 });
  if (group.is_private) return Response.json({ error: 'This club is invite only' }, { status: 403 });
  if (blockedIds(group).includes(user.id)) {
    return Response.json({ error: 'The club owner removed you from this club' }, { status: 403 });
  }

  const current = memberIds(group);
  if (current.includes(user.id)) return Response.json({ ok: true });
  if (current.length >= MAX_MEMBERS) return Response.json({ error: 'This club is full' }, { status: 400 });

  // The member list belongs to the club's owner, so putting this reader on it is the one
  // write here that the caller's own token may not make.
  await base44.asServiceRole.entities.BookGroup.update(group.id, { member_ids: [...current, user.id] });
  return Response.json({ ok: true });
}

// Display names come from the service role: app users can't read other users' records.
// Readers still deciding are listed last, under the name captured when the invite went out.
async function roster(base44, group) {
  const ids = memberIds(group);
  const invited = ids.filter((id) => id !== group.created_by_id);
  const [owner, users, invites] = await Promise.all([
    base44.asServiceRole.entities.User.get(group.created_by_id).catch(() => null),
    invited.length ? base44.asServiceRole.entities.User.filter({ id: { $in: invited } }) : [],
    group.is_private
      ? base44.asServiceRole.entities.GroupInvite.filter({ group_id: group.id, status: 'pending' })
      : [],
  ]);

  const names = new Map((users || []).map((u) => [u.id, u.full_name || 'Reader']));
  return {
    members: [
      { id: group.created_by_id, name: owner?.full_name || 'Group owner', role: 'owner' },
      ...invited.map((id) => ({ id, name: names.get(id) || 'Reader', role: 'member' })),
    ],
    pending: (invites || [])
      .filter((invite) => invite.invitee_id !== group.created_by_id && !ids.includes(invite.invitee_id))
      .map((invite) => ({ id: invite.invitee_id, name: invite.invitee_name || 'Reader' })),
  };
}