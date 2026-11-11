
import { createSocialGraphHandler } from "../../_lib/socialGraphHandler.js";

export default function handler(req, res) {
  const operation = req.method === "GET"
    ? (req.query?.email !== undefined || req.query?.username !== undefined ? "search" : "list")
    : "follow";
  return createSocialGraphHandler({ operation })(req, res);
}
