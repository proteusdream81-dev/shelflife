import React, { useState } from "react";
import { Users, Lock, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import CircleFilter, { filterByName } from "@/components/tbr/CircleFilter";

const OPTIONS = [
  { value: "circle", label: "Whole circle", Icon: Users },
  { value: "selected", label: "Chosen readers", Icon: Lock },
];

// Picks who a shared shelf or book is visible to: everyone who follows the reader, or
// only the individual readers ticked here.
export default function ShareAudience({ audience, chosen, readers, loading, onAudience, onToggle, what = "this shelf" }) {
  const [query, setQuery] = useState("");
  const isChosen = (id) => chosen.some((c) => c.id === id);
  const shown = filterByName(readers, query);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={audience === value}
            onClick={() => onAudience(value)}
            className={`vp-btn justify-center gap-2 ${audience === value ? "vp-active" : ""}`}
          >
            <Icon strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </div>

      {audience === "circle" ? (
        <p className="text-xs text-muted-foreground">
          Everyone who follows you can browse {what}.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Only the readers you tick below can see {what} — nobody else in your circle.
          </p>

          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && readers.length === 0 && (
            <p className="vp-empty text-xs">
              Nobody in your reading circle yet — find readers on the Reading circle page.
            </p>
          )}

          {!loading && readers.length > 1 && (
            <CircleFilter value={query} onChange={setQuery} placeholder="Search your circle by name..." />
          )}

          {!loading && readers.length > 0 && shown.length === 0 && (
            <p className="vp-empty text-xs">No reader in your circle matches that name.</p>
          )}

          {!loading && shown.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {shown.map((reader) => (
                <label
                  key={reader.id}
                  className="flex items-center gap-3 px-3 py-3 cursor-pointer border-b border-border last:border-b-0"
                >
                  <Checkbox checked={isChosen(reader.id)} onCheckedChange={() => onToggle(reader)} />
                  <span className="text-sm truncate">{reader.name || "Reader"}</span>
                </label>
              ))}
            </div>
          )}

          <p className="text-xs text-primary">
            {chosen.length === 0
              ? `Pick at least one reader — right now nobody can see ${what}.`
              : `Shared with ${chosen.length} ${chosen.length === 1 ? "reader" : "readers"}.`}
          </p>
        </>
      )}
    </div>
  );
}