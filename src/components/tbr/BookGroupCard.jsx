import React from "react";
import moment from "moment";
import { Loader2, Lock, MapPin, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// One club as it appears in a list. The body opens the club; a public club the reader is
// not in yet also carries the one action that puts them in it, as a separate button rather
// than a tap on the card.
export default function BookGroupCard({ group, onOpen, onJoin, joining }) {
  const members = Array.isArray(group.member_ids) ? group.member_ids.length : 0;

  return (
    <div className="vp-panel p-4 flex gap-3 transition-colors hover:border-primary/60">
      <div className="w-10 h-10 shrink-0 rounded-xl bg-primary/15 text-primary grid place-items-center">
        <MessageCircle className="w-5 h-5" strokeWidth={1.8} />
      </div>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpen(group)} className="w-full text-left">
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
        </button>

        <p className="text-xs text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {group.category && <span className="text-primary/80 font-semibold">{group.category}</span>}
          {group.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {group.location}
            </span>
          )}
          <span>{members > 0 ? `${members} member${members === 1 ? "" : "s"}` : "No members yet"}</span>
          <span>Started {moment(group.created_date).fromNow()}</span>
        </p>

        {group.meets && <p className="text-xs text-muted-foreground mt-1 truncate">Meets {group.meets}</p>}

        {onJoin && (
          <Button size="sm" className="mt-3" onClick={() => onJoin(group)} disabled={joining}>
            {joining ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
            Join club
          </Button>
        )}
      </div>
    </div>
  );
}