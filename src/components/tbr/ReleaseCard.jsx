import React from "react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { Image } from "@/components/ui/image";
import { CalendarDays, Feather } from "lucide-react";
import { authorPath, displayAuthor } from "@/lib/bookAuthors";

// Two taps on one card: the book itself opens its details, and the author opens their page.
export default function ReleaseCard({ release, onOpen }) {
  const when = moment(release.date);
  const upcoming = when.isSameOrAfter(moment(), "day");
  const author = displayAuthor(release.author);
  const navigate = useNavigate();

  return (
    <article className="vp-panel p-3">
      <button
        type="button"
        onClick={() => onOpen?.(release)}
        className="flex w-full gap-3 text-left"
        aria-label={`${release.title}, out ${when.format("D MMMM YYYY")}`}
      >
        <span className="w-14 shrink-0 overflow-hidden rounded-lg bg-secondary aspect-[2/3]">
          <Image src={release.cover_url} alt={release.title} className="w-full h-full object-cover" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-heading text-base leading-tight">{release.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            <CalendarDays className="w-3.5 h-3.5 inline mr-1 align-[-2px]" />
            {when.format("D MMM YYYY")}
            {upcoming ? ` · in ${when.fromNow(true)}` : ""}
          </span>
        </span>
      </button>

      {author && (
        <button
          type="button"
          className="vp-btn vp-small mt-2"
          onClick={() => navigate(authorPath(author))}
          aria-label={`More books by ${author}`}
        >
          <Feather /> More by {author}
        </button>
      )}
    </article>
  );
}