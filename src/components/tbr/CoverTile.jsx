import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import { Check, Loader2 } from "lucide-react";

// One cover in the picker. A catalogue can answer with a link whose picture has since been
// withdrawn, which would otherwise sit in the grid as a broken image and invite a reader to
// choose it. So a tile waits for its picture, and one that never arrives takes itself out of
// the grid and says so, leaving only covers that can actually be shown.
export default function CoverTile({ url, isChosen, busy, onPick, onBroken }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) return null;

  return (
    <button
      type="button"
      onClick={() => !busy && onPick(url)}
      disabled={busy}
      aria-pressed={isChosen}
      aria-label={isChosen ? "Current cover" : "Use this cover"}
      className={`relative aspect-[2/3] overflow-hidden rounded-md border transition-colors ${
        isChosen ? "border-primary" : "border-border hover:border-primary/60"
      }`}
    >
      {!loaded && (
        <span className="absolute inset-0 grid place-items-center bg-secondary/40">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </span>
      )}
      <Image
        src={url}
        alt=""
        fittingType="fill"
        className="h-full w-full"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          onBroken?.(url);
        }}
      />
      {isChosen && (
        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}