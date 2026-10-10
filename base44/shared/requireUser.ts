// Every backend function starts with this guard. A function's URL is public, so
// nothing may be read, written, or sent back before the caller is identified.
// Returns the signed-in caller, or null — callers then answer with unauthorized().
export async function requireUser(base44) {
  try {
    return await base44.auth.me();
  } catch {
    return null;
  }
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}