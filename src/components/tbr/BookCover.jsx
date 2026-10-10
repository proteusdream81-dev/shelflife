import React, { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { coverCandidates } from "@/lib/bookCovers";

/**
 * A book's cover. Open Library answers with a blank one-pixel image — not an
 * error — for a book it has no art for, so each source is loaded in turn and
 * checked, and the title art (or the `fallback` given, for a small thumbnail)
 * stands in when none of them really has a cover.
 */
export default function BookCover({ book, className = "vp-cover", fallback }) {
  const candidates = coverCandidates(book);
  const sources = candidates.join("|");
  const [index, setIndex] = useState(0);
  const [missing, setMissing] = useState(candidates.length === 0);

  useEffect(() => {
    setIndex(0);
    setMissing(candidates.length === 0);
  }, [sources]);

  const advance = () => {
    if (index + 1 < candidates.length) setIndex(index + 1);
    else setMissing(true);
  };

  if (missing) {
    return fallback === undefined ? (
      <div className={`${className} vp-art`}>
        <span>{book.title}</span>
      </div>
    ) : (
      <div className={className}>{fallback}</div>
    );
  }

  const src = candidates[index];

  return (
    <div className={className}>
      <Image
        key={src}
        src={src}
        alt={book.title || ""}
        fittingType="fill"
        className="w-full h-full"
        onLoad={(event) => {
          if ((event?.target?.naturalWidth || 0) <= 1) advance();
        }}
        onError={advance}
      />
    </div>
  );
}