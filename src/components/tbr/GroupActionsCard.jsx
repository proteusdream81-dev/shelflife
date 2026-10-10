import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, LogOut, Trash2 } from "lucide-react";

export default function GroupActionsCard({ group, isOwner, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await base44.functions.invoke("bookGroups", { action, group_id: group.id });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't go through — please try again.");
      setBusy(false);
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>{isOwner ? "Group settings" : "Your membership"}</h2>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {isOwner
          ? "Closing a group removes it and its chat for every reader in it."
          : "Leaving takes this group off your list; the owner can invite you back later."}
      </p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant={isOwner ? "destructive" : "outline"} disabled={busy}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isOwner ? (
              <Trash2 className="w-4 h-4" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            {isOwner ? "Close group" : "Leave group"}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner ? `Close “${group.name}”?` : `Leave “${group.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "The group and everything in its chat disappears for everyone. This cannot be undone."
                : "You will stop seeing this group and its chat. The owner can invite you back."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(isOwner ? "close" : "leave")}
              className={isOwner ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {isOwner ? "Close group" : "Leave group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}