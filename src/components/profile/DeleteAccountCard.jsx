import React, { useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { deleteAccountData } from "@/lib/deleteAccountData";
import { Loader2, Trash2 } from "lucide-react";

const WARNING = "Your books, shelves, shared links, reading circle connections and any groups you created will be permanently deleted, and you'll be signed out. This can't be undone.";

export default function DeleteAccountCard({ userId, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const confirmDelete = async () => {
    setWorking(true);
    setError("");
    try {
      await deleteAccountData(userId);
      setOpen(false);
      onDeleted();
    } catch {
      setError("We couldn't delete your data. Please try again in a moment.");
      setWorking(false);
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Delete account</h2>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground min-w-0">{WARNING}</p>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0"
          onClick={() => { setError(""); setOpen(true); }}
        >
          <Trash2 className="w-4 h-4" />
          Delete account
        </Button>
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}

      <AlertDialog open={open} onOpenChange={(next) => { if (!working) setOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>{WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(event) => { event.preventDefault(); confirmDelete(); }}
            >
              {working && <Loader2 className="w-4 h-4 animate-spin" />}
              {working ? "Deleting..." : "Delete everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}