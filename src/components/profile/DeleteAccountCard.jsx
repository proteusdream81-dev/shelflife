import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";

// The reader types this word to unlock the delete button, so a stray tap can't end an account.
const CONFIRM_WORD = "DELETE";

const REMOVED = [
  "your account itself",
  "every book and shelf you added, with the ratings and notes on them",
  "cover images you uploaded, and any library you imported",
  "your reading circle connections, both the readers you follow and your followers",
];

export default function DeleteAccountCard({ userId, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  // Once it is gone the reader is told so, then the sign-out takes the page away. The button
  // beside it does the same thing early for anyone who would rather not wait.
  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => onDeleted(), 1800);
    return () => clearTimeout(timer);
  }, [done, onDeleted]);

  const confirmDelete = async () => {
    if (!ready || working) return;
    setWorking(true);
    setError("");
    try {
      await deleteAccountData(userId);
      setDone(true);
    } catch {
      setError("We couldn't finish deleting your account. Please try again in a moment.");
      setWorking(false);
    }
  };

  // While the deletion is running, or once it has finished, the dialog stays put: closing it
  // halfway would leave the reader unsure whether their account is gone.
  const changeOpen = (next) => {
    if (working || done) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      setError("");
    }
  };

  return (
    <section className="vp-shelf vp-danger">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Delete account</h2>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Deleting your account removes it and everything in it for good. This can't be undone.
      </p>

      <Button
        variant="destructive"
        size="sm"
        className="mt-4"
        onClick={() => {
          setTyped("");
          setError("");
          setOpen(true);
        }}
      >
        <Trash2 className="w-4 h-4" />
        Delete account
      </Button>

      {error && !open && (
        <p role="alert" className="text-sm text-destructive mt-3">
          {error}
        </p>
      )}

      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogContent>
          {done ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Your account is deleted
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Everything you added to ShelfLife is gone. Signing you out now.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="outline" onClick={() => onDeleted()}>
                  Sign out now
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This is permanent, and it can't be undone. It removes:
                </AlertDialogDescription>
              </AlertDialogHeader>

              <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
                {REMOVED.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmDelete();
                }}
                className="space-y-2"
              >
                <label
                  htmlFor="delete-account-confirm"
                  className="text-sm font-medium text-foreground"
                >
                  Type {CONFIRM_WORD} to confirm
                </label>
                <Input
                  id="delete-account-confirm"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={CONFIRM_WORD}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={working}
                  className="h-11"
                />
              </form>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={working}>Keep my account</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!ready || working}
                  className="!bg-destructive !text-destructive-foreground hover:!bg-destructive/90"
                  onClick={(event) => {
                    event.preventDefault();
                    confirmDelete();
                  }}
                >
                  {working && <Loader2 className="w-4 h-4 animate-spin" />}
                  {working ? "Deleting..." : "Delete everything"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}