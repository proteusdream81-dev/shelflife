import { createGroupChatHandler } from "../../../_lib/groupChatHandler.js";

export default function handler(req, res) {
  const operation = req.method === "GET" ? "list" : "send";
  return createGroupChatHandler({ operation })(req, res);
}
