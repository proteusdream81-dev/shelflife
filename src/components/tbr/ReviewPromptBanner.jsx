import React from "react";
import { Button } from "@/components/ui/button";
import { Star, X } from "lucide-react";
import { PLAY_STORE_URL } from "@/lib/reviewPrompt";

export default function ReviewPromptBanner({ onDismiss }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-3 mt-4">
      <p className="text-sm flex-1 min-w-[12rem]">
        Loving ShelfLife? Leave us a review on the Play Store - it really helps!
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={() => window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer")}>
          <Star className="w-4 h-4" /> Leave a review
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-2 rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}