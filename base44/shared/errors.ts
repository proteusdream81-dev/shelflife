// Every backend function answers an unexpected failure the same way: the real error is
// written to the server log, where it can be diagnosed, and the caller is told only that
// something went wrong. A function's URL is public — one of them, the share lookup, is
// deliberately open to strangers — and raw exception text names internals such as SDK
// calls, storage paths and upstream hosts, which is useful reconnaissance for an attacker
// and of no use to a reader.
export function serverError(error, status = 500, message = 'Something went wrong. Please try again.') {
  console.error('[serverError]', error);
  return Response.json({ error: message }, { status });
}