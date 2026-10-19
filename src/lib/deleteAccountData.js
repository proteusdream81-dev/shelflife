import { base44 } from "@/api/base44Client";

// The deletion itself runs on the server, where the account's own rows can be found on both sides
// of every connection and the account record the sign-in belongs to can be removed. This is the
// signed-in reader's way of asking for it, and the button in Settings and the same button on the
// account deletion page both come through here.
export async function deleteAccountData() {
  const { data } = await base44.functions.invoke("accountDeletion", { action: "current" });
  if (!data?.ok) throw new Error(data?.error || "Deletion failed");
  return true;
}