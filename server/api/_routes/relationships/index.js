import { createSocialGraphHandler } from "../../_lib/socialGraphHandler.js";

export function resolveReadingCircleOperation(req) {
  if (req.method !== "GET") return "follow";
  if (req.query?.overview === "true") return "overview";
  if (["email", "username", "name", "checkUsername"].some((key) => req.query?.[key] !== undefined)) return "search";
  return "list";
}

export default function handler(req, res) {
  return createSocialGraphHandler({ operation: resolveReadingCircleOperation(req) })(req, res);
}
