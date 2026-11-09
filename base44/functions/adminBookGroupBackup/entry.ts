import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

const EXPORTABLE_ENTITIES = [
  'GroupInvite',
  'Book',
  'Follow',
  'Comment',
  'BookGroup',
  'ReaderSearch',
  'BookSearchCache',
  'WaitlistAttempt',
  'AccountDeletionRequest',
  'Report',
  'RateLimitHit',
  'Block',
  'PlacesCache',
  'Shelf',
  'Waitlist',
  'ClubSearchCache',
  'ReleaseReminder',
  'User',
];

const PAGE_SIZE_MAX = 500;

const asRows = (result) => {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
};

// Read-only, admin-only export support. This function never writes to app data.
// Group messages are exported separately through the BookGroupRoom actor.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'groups') {
      const requestedLimit = Number(body.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), PAGE_SIZE_MAX)
        : PAGE_SIZE_MAX;
      const requestedSkip = Number(body.skip);
      const skip = Number.isFinite(requestedSkip)
        ? Math.max(Math.floor(requestedSkip), 0)
        : 0;
      const [result, count] = await Promise.all([
        base44.asServiceRole.entities.BookGroup.filter({}, '-created_date', limit, skip),
        base44.asServiceRole.entities.BookGroup.count(),
      ]);
      const rows = asRows(result);
      return Response.json({
        groups: rows.map((group) => ({
          id: group.id,
          name: group.name || '',
          is_private: group.is_private === true,
          created_date: group.created_date || null,
        })),
        count,
        skip,
        limit,
        inventory_complete: rows.length + skip >= count,
        inventory_scope: 'current BookGroup records only; deleted/orphaned actor IDs are not enumerable',
      });
    }

    if (action === 'entity_page') {
      const entityName = String(body.entity_name || '');
      if (!EXPORTABLE_ENTITIES.includes(entityName)) {
        return Response.json({ error: 'Entity is not on the export allowlist' }, { status: 400 });
      }

      const requestedLimit = Number(body.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), PAGE_SIZE_MAX)
        : PAGE_SIZE_MAX;
      const requestedSkip = Number(body.skip);
      const skip = Number.isFinite(requestedSkip)
        ? Math.max(Math.floor(requestedSkip), 0)
        : 0;

      const entity = base44.asServiceRole.entities[entityName];
      if (!entity) return Response.json({ error: 'Entity is unavailable' }, { status: 404 });

      const [result, count] = await Promise.all([
        entity.filter({}, '-created_date', limit, skip),
        entity.count(),
      ]);
      const items = asRows(result);
      return Response.json({ entity_name: entityName, items, count, skip, limit });
    }

    return Response.json({ error: 'Unknown export action' }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}
