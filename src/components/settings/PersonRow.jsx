import React from "react";

// One reader in a follow list: who they are, why they are listed, and the actions that apply
// to them there.
export default function PersonRow({ name, note, children }) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/20 bg-secondary/40">
      <div className="min-w-0">
        <p className="text-sm font-medium line-clamp-1">{name}</p>
        {note && <p className="text-xs text-muted-foreground line-clamp-1">{note}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">{children}</div>
    </div>
  );
}