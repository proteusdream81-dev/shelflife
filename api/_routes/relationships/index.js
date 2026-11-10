import { createSocialGraphHandler } from "../_lib/socialGraphHandler.js";

export default function handler(req, res) {
  const operation = req.method === "GET" ? "list" : "follow";
  return createSocialGraphHandler({ operation })(req, res);
}
