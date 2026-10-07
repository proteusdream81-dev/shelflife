import React from "react";
import { Button } from "@/components/ui/button";

export default function ReaderCard({ reader, onView, onUnfollow, onFollow }) {
  const shelves = reader.shared_shelves || 0;
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-primary/20 bg-secondary/40">
      <div className="min-w-0">
        <p className="text-sm font-medium line-clamp-1">{reader.name}</p>
        <p className="text-xs text-muted-foreground">
          {shelves ? `${shelves} shared shelf${shelves === 1 ? "" : "s"}` : "Hasn't shared any shelves"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onFollow && <Button size="sm" variant="outline" onClick={() => onFollow(reader.id)}>Follow back</Button>}
        {onView && <Button size="sm" variant="outline" onClick={() => onView(reader)}>Shelves</Button>}
        {onUnfollow && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onUnfollow(reader.id)}>
            Unfollow
          </Button>
        )}
      </div>
    </div>
  );
}