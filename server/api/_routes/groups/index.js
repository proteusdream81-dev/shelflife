import { createGroupMembershipHandler } from "../../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  const operation = req.method === "GET" ? "list" : "create";
  return createGroupMembershipHandler({ operation })(req, res);
}
