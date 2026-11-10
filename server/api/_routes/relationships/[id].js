import { createSocialGraphHandler } from "../../_lib/socialGraphHandler.js";

export default async function handler(req, res) {
  const operation = req.method === "PATCH" ? "accept" : "remove";
  return createSocialGraphHandler({ operation })(req, res);
}
