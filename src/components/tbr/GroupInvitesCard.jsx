import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, Mailbox } from "lucide-react";

export default function GroupInvitesCard({ onAccepted }) {
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    base44.auth
      .me()
      .then((me) =>
        base44.entities.GroupInvite.filter({ invitee_id: me.id, status: "pending" }, { sort: "-created_date" })
      )
      .then((page) => setInvites(page?.items || []))
      .catch(() => {});
  }, []);

  const respond = async (invite, action) => {
    setBusy(invite.id);
    setError("");
    try {
      await base44.functions.invoke("bookGroups", { action, invite_id: invite.id });
      setInvites((prev) => prev.filter((row) => row.id !== invite.id));
      if (action === "accept") onAccepted?.();
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't go through — please try again.");
    } finally {
      setBusy("");
    }
  };

  if (invites.length === 0) return null;

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Group invites</h2>
          <span className="vp-badge">{invites.length}</span>
        </div>
      </div>

      <div className="space-y-2">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/20 bg-secondary/40"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">
                <Mailbox className="w-4 h-4 shrink-0 text-primary" /> {invite.group_name}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">Invited by {invite.inviter_name}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={() => respond(invite, "accept")} disabled={busy === invite.id}>
                {busy === invite.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Accept"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => respond(invite, "decline")} disabled={busy === invite.id}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}