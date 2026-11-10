import { createGroupMembershipHandler } from "../../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  const action = req.query?.action;
  if (action !== "leave" && action !== "close") {
    return res.status(400).json({ error: "Action must be leave or close" });
  }
  const operation = action === "close" ? "close" : "leave";
  return createGroupMembershipHandler({ operation })(req, res);
}
