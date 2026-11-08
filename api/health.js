export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    service: "shelflife-api",
    runtime: "vercel",
    timestamp: new Date().toISOString(),
  });
}
