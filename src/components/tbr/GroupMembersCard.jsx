import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";

export default function GroupMembersCard({ groupId, members, pending, canManage, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const remove = async (userId) => {
    setBusy(userId);
    setError("");
    try {
      const { data } = await base44.functions.invoke("bookGroups", {
        action: "remove",
        group_id: groupId,
        user_id: userId,
      });
      onChanged(data);
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't go through — please try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Members</h2>
          <span className="vp-badge">{members.length}</span>
        </div>
      </div>

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/20 bg-secondary/40"
          >
            <p className="text-sm font-medium min-w-0 truncate">{member.name}</p>
            {member.role === "owner" ? (
              <span className="text-[11px] font-semibold text-primary shrink-0">Owner</span>
            ) : canManage ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(member.id)}
                disabled={busy === member.id}
                title="Remove from group"
                aria-label={`Remove ${member.name} from this group`}
              >
                {busy === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              </Button>
            ) : null}
          </div>
        ))}

        {pending.map((invitee) => (
          <div
            key={invitee.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/10 bg-secondary/20"
          >
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground truncate">{invitee.name}</p>
              <p className="text-[11px] text-muted-foreground">Waiting to accept your invite</p>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(invitee.id)}
                disabled={busy === invitee.id}
                title="Withdraw this invite"
                aria-label={`Withdraw the invite to ${invitee.name}`}
              >
                {busy === invitee.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              </Button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}