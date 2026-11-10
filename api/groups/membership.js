import { createGroupChatHandler } from "../_lib/groupChatHandler.js";
import { createGroupMembershipHandler } from "../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  const action = req.query?.action;
  if (action === "chat") {
    const operation = req.method === "GET" ? "list" : req.method === "POST" ? "create" : "delete";
    return createGroupChatHandler({ operation })(req, res);
  }
  if (action !== "leave" && action !== "close") {
    return res.status(400).json({ error: "Action must be leave or close" });
  }
  const operation = action === "close" ? "close" : "leave";
  return createGroupMembershipHandler({ operation })(req, res);
}
