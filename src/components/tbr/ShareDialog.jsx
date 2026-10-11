import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import SharePanel from "@/components/tbr/SharePanel";

export default function ShareDialog({ open, onOpenChange, shelf, onSaved }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{shelf?.name}"</DialogTitle>
          <DialogDescription>Decide who can browse this shelf from their reading circle.</DialogDescription>
        </DialogHeader>

        <SharePanel item={shelf} kind="shelf" onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}