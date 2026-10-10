import React from "react";
import moment from "moment";
import { Lock, MessageCircle } from "lucide-react";

export default function BookGroupCard({ group, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(group)}
      className="vp-panel w-full text-left p-4 flex gap-3 transition-colors hover:border-primary/60"
    >
      <div className="w-10 h-10 shrink-0 rounded-xl bg-primary/15 text-primary grid place-items-center">
        <MessageCircle className="w-5 h-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-heading text-lg leading-tight truncate">{group.name}</h3>
          {group.is_private && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary/90">
              <Lock className="w-3.5 h-3.5" /> Private
            </span>
          )}
        </div>
        {group.book_title && (
          <p className="text-xs text-primary/80 mt-0.5 truncate">Reading {group.book_title}</p>
        )}
        {group.description && (
          <p className="text-sm text-muted-foreground mt-1 truncate">{group.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          Started {moment(group.created_date).fromNow()}
        </p>
      </div>
    </button>
  );
}