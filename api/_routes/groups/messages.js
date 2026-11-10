import { createGroupChatHandler } from "../../_lib/groupChatHandler.js";

export default async function handler(req, res) {
  const operation = req.method === "GET" ? "list" : req.method === "POST" ? "create" : "delete";
  return createGroupChatHandler({ operation })(req, res);
}
