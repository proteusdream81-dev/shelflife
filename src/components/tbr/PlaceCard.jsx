import React from "react";
import { Library, Navigation, Store } from "lucide-react";

export default function PlaceCard({ place }) {
  const isLibrary = place.kind === "library";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`;

  return (
    <article className="vp-panel p-4 flex gap-3">
      <div className={`w-10 h-10 shrink-0 rounded-xl grid place-items-center ${isLibrary ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"}`}>
        {isLibrary
          ? <Library className="w-5 h-5" strokeWidth={1.8} />
          : <Store className="w-5 h-5" strokeWidth={1.8} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-lg leading-tight">{place.name}</h3>
          <span className="text-xs text-muted-foreground whitespace-nowrap pt-1">{place.distance_km} km</span>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
          {isLibrary ? "Library" : "Bookshop"}
        </p>
        {place.address && <p className="text-sm text-muted-foreground mt-1">{place.address}</p>}
        <div className="flex flex-wrap gap-2 mt-3">
          <a href={directions} target="_blank" rel="noopener noreferrer" className="vp-btn vp-small">
            <Navigation /> Directions
          </a>
        </div>
      </div>
    </article>
  );
}