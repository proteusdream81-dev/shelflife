import { createGroupMembershipHandler } from "../../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  const operation = req.method === "PATCH" ? "respond" : "invite";
  return createGroupMembershipHandler({ operation })(req, res);
}
