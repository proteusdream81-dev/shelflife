import React from "react";
import { ExternalLink, Users } from "lucide-react";

// One club found in a public listing, out in the world. It is not a ShelfLife club, so the
// reader joins it on the club's own page, and the only thing offered here besides that is
// starting a club of their own like it.
export default function PublicClubRow({ club, onStartLike }) {
  const meta = [club.meets, club.source && `Listed on ${club.source}`].filter(Boolean).join(" · ");

  return (
    <div className="vp-panel p-4">
      <h3 className="font-heading text-lg leading-tight">{club.name}</h3>
      <p className="text-xs text-primary/80 mt-0.5">
        {[club.category, club.where].filter(Boolean).join(" · ")}
      </p>
      {club.description && (
        <p className="text-sm text-muted-foreground mt-2">{club.description}</p>
      )}
      {meta && <p className="text-xs text-muted-foreground mt-2">{meta}</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        <a
          href={club.url}
          target="_blank"
          rel="noopener noreferrer"
          className="vp-btn vp-primary"
        >
          <ExternalLink /> Open club page
        </a>
        {onStartLike && (
          <button type="button" className="vp-btn" onClick={() => onStartLike(club)}>
            <Users /> Start one like this
          </button>
        )}
      </div>
    </div>
  );
}