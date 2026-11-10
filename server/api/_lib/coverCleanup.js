const COVER_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

export async function deleteCoverObject({
  workerUrl, objectKey, uid, bearerToken, fetchImpl = (...args) => fetch(...args),
}) {
  if (typeof workerUrl !== "string" || !workerUrl) return false;
  if (typeof uid !== "string" || !uid || typeof bearerToken !== "string" || !bearerToken) return false;
  if (typeof objectKey !== "string" || objectKey.length > 180) return false;
  const parts = objectKey.split("/");
  if (parts.length !== 2 || parts[0] !== uid || !COVER_FILENAME.test(parts[1])) return false;
  let base;
  try { base = new URL(workerUrl); } catch { return false; }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return false;
  const url = new URL("/v1/covers/" + encodeURIComponent(objectKey), base.origin);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
