import { createCommentsHandler } from ".././_lib/commentsHandler.js";

export default function handler(req, res) {
  const operation = req.method === "GET" ? "list" : "create";
  return createCommentsHandler({ operation })(req, res);
}
