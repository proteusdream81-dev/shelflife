import { createGroupMembershipHandler } from "../_lib/groupMembershipHandler.js";

export default function handler(req, res) {
  return createGroupMembershipHandler({ operation: "remove" })(req, res);
}
