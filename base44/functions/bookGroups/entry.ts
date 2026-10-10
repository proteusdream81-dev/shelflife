import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';

const MAX_MEMBERS = 50;

const memberIds = (group) =>
  Array.from(new Set((Array.isArray(group.member_ids) ? group.member_ids : []).map(String))).slice(0, MAX_MEMBERS);

// A private group is for its owner and the readers the owner invited; a public one is
// open to any signed-in reader.
const maySee = (group, userId) =>
  !group.is_private || group.created_by_id === userId || memberIds(group).includes(userId);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const groupId = String(body.group_id || '').trim();
    if (!groupId) return Response.json({ error: 'A group is required' }, { status: 400 });

    // The caller's own token reads the group, so the group's rules decide what exists
    // for them: a private group someone else runs is simply not found.
    const group = await base44.entities.BookGroup.get(groupId).catch(() => null);
    if (!group) return Response.json({ error: 'Group not found' }, { status: 404 });
    if (!maySee(group, user.id)) return Response.json({ error: 'This group is private' }, { status: 403 });

    const action = String(body.action || 'members');

    if (action !== 'members' && action !== 'invite' && action !== 'remove') {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    if (action !== 'members') {
      if (group.created_by_id !== user.id) {
        return Response.json({ error: 'Only the group owner can manage invites' }, { status: 403 });
      }

      const targetId = String(body.user_id || '').trim();
      if (!targetId || targetId === user.id) {
        return Response.json({ error: 'Pick a reader to invite' }, { status: 400 });
      }
      if (!(await base44.asServiceRole.entities.User.get(targetId).catch(() => null))) {
        return Response.json({ error: 'That reader no longer exists' }, { status: 404 });
      }

      const current = memberIds(group);
      if (action === 'invite' && !current.includes(targetId) && current.length >= MAX_MEMBERS) {
        return Response.json({ error: `A group can invite up to ${MAX_MEMBERS} readers` }, { status: 400 });
      }

      const next = action === 'invite'
        ? Array.from(new Set([...current, targetId]))
        : current.filter((id) => id !== targetId);

      await base44.entities.BookGroup.update(group.id, { member_ids: next });
      return Response.json({ members: await listMembers(base44, group, next) });
    }

    return Response.json({ members: await listMembers(base44, group, memberIds(group)) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Display names come from the service role: app users can't read other users' records.
// The owner is always first, so the guest list reads as one roster.
async function listMembers(base44, group, ids) {
  const invited = ids.filter((id) => id !== group.created_by_id);
  const [owner, users] = await Promise.all([
    base44.asServiceRole.entities.User.get(group.created_by_id).catch(() => null),
    invited.length ? base44.asServiceRole.entities.User.filter({ id: { $in: invited } }) : [],
  ]);
  const names = new Map((users || []).map((u) => [u.id, u.full_name || 'Reader']));
  return [
    { id: group.created_by_id, name: owner?.full_name || 'Group owner', role: 'owner' },
    ...invited.map((id) => ({ id, name: names.get(id) || 'Reader', role: 'member' })),
  ];
}