import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

// Returns only the room identifiers and display names needed to drive an actor export.
// Authorization is checked server-side; the actor independently re-checks admin role.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Administrator access required' }, { status: 403 });

    const groups = [];
    const seen = new Set();
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const result = await base44.asServiceRole.entities.BookGroup.filter(
        {},
        { limit: 200, cursor },
      );
      const items = Array.isArray(result?.items) ? result.items : null;
      if (!items) return Response.json({ error: 'Unexpected BookGroup response; export list rejected.' }, { status: 502 });
      for (const group of items) {
        if (!group?.id || seen.has(group.id)) {
          return Response.json({ error: 'Missing or duplicate group id; export list rejected.' }, { status: 502 });
        }
        seen.add(group.id);
        groups.push({ id: group.id, name: String(group.name || 'Untitled group') });
      }
      if (!result.has_more) {
        return Response.json({ ok: true, count: groups.length, groups });
      }
      if (!result.next_cursor || result.next_cursor === cursor) {
        return Response.json({ error: 'Incomplete BookGroup pagination; export list rejected.' }, { status: 502 });
      }
      cursor = result.next_cursor;
    }

    return Response.json({ error: 'BookGroup pagination exceeded the safety limit.' }, { status: 502 });
  } catch (error) {
    console.error('[adminListBookGroupRooms] export inventory failed', error);
    return Response.json({ error: 'Unable to enumerate group rooms.' }, { status: 500 });
  }
}
