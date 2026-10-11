import React, { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import SharePanel from "@/components/tbr/SharePanel";

export default function ShareDialog({ open, onOpenChange, shelf, onSaved }) {
  const counted = useRef(false);

  useEffect(() => {
    counted.current = false;
  }, [shelf?.id]);

  // The shelves-shared KPI counts each shelf once, at the moment its link is first
  // generated or copied.
  const handleShared = () => {
    if (counted.current) return;
    counted.current = true;
    base44.analytics.track({ eventName: "shelf_shared" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{shelf?.name}"</DialogTitle>
          <DialogDescription>Decide who can browse this shelf from their reading circle.</DialogDescription>
        </DialogHeader>

        <SharePanel item={shelf} kind="shelf" onSaved={onSaved} onShared={handleShared} />
      </DialogContent>
    </Dialog>
  );
}