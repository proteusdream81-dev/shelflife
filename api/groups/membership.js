import { createGroupMembershipHandler } from "../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  const operation = req.query?.action === "close" ? "close" : "leave";
  return createGroupMembershipHandler({ operation })(req, res);
}
