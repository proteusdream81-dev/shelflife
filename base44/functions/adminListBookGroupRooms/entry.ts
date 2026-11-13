import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

const PAGE_SIZE = 200;
const MAX_PAGES = 20;

async function readBookGroups(base44) {
  const groups = [];
  const seen = new Set();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const skip = page * PAGE_SIZE;
    const items = await base44.asServiceRole.entities.BookGroup.list(
      '-created_date',
      PAGE_SIZE,
      skip,
      ['id', 'name'],
    );

    if (!Array.isArray(items) || items.length > PAGE_SIZE) {
      throw new Error('Unexpected BookGroup list response.');
    }

    for (const group of items) {
      if (!group?.id || seen.has(group.id)) {
        throw new Error('Missing or duplicate BookGroup ID.');
      }
      seen.add(group.id);
      groups.push({ id: group.id, name: String(group.name || 'Untitled group') });
    }

    if (items.length < PAGE_SIZE) return groups;
  }

  throw new Error('BookGroup inventory exceeded the safety page limit.');
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Administrator access required' }, { status: 403 });

    // Two sorted inventories catch changes or pagination shifts during enumeration.
    const first = await readBookGroups(base44);
    const second = await readBookGroups(base44);
    const signature = (items) => JSON.stringify(items.map(({ id, name }) => [id, name]));
    if (signature(first) !== signature(second)) {
      return Response.json({ error: 'BookGroup inventory changed during enumeration; retry later.' }, { status: 409 });
    }

    return Response.json({ ok: true, count: second.length, groups: second });
  } catch (error) {
    console.error('[adminListBookGroupRooms] export inventory failed', error);
    return Response.json({ error: 'Unable to enumerate a stable BookGroup inventory.' }, { status: 500 });
  }
}
