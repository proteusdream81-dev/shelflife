import React from "react";
import { Switch } from "@/components/ui/switch";
import { BookOpen, Flag, Loader2 } from "lucide-react";

// How the shelves look to this reader and to the people they share with: whether other
// readers get to see their covers, and whether content warnings show as they read.
export default function DisplayCard({ hideCovers, showWarnings, savingKey, disabled, error, onToggle }) {
  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Display</h2>
        </div>
        {savingKey && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <BookOpen className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />
              {hideCovers ? "Your covers are hidden" : "Your covers are visible"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {hideCovers
                ? "Anyone else looking at your shelves sees a plain ShelfLife cover instead of the artwork — on shared links too."
                : "Readers you share with see the real cover art. Turn this on to show a plain ShelfLife cover instead."}
            </p>
          </div>
          <Switch
            checked={hideCovers}
            onCheckedChange={(next) => onToggle("hide_covers", next)}
            disabled={disabled || savingKey === "hide_covers"}
            aria-label="Hide my covers from other readers"
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <Flag className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />
              {showWarnings ? "Content warnings are showing" : "Content warnings are hidden"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {showWarnings
                ? "The warnings you've tagged your books with appear on book pages and on your shelves."
                : "Your tagged warnings are still saved, just not shown while you browse."}
            </p>
          </div>
          <Switch
            checked={showWarnings}
            onCheckedChange={(next) => onToggle("show_content_warnings", next)}
            disabled={disabled || savingKey === "show_content_warnings"}
            aria-label="Show content warnings"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}