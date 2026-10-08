import React from "react";
import moment from "moment";
import { Image } from "@/components/ui/image";
import { CalendarDays } from "lucide-react";

export default function ReleaseCard({ release }) {
  const when = moment(release.date);
  const upcoming = when.isSameOrAfter(moment(), "day");

  return (
    <article className="vp-panel p-3 flex gap-3">
      <div className="w-14 shrink-0 overflow-hidden rounded-lg bg-secondary aspect-[2/3]">
        <Image src={release.cover_url} alt={release.title} className="w-full h-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading text-base leading-tight">{release.title}</h3>
        <p className="text-xs text-primary/80 mt-0.5">{release.author}</p>
        <p className="text-xs text-muted-foreground mt-1">
          <CalendarDays className="w-3.5 h-3.5 inline mr-1 align-[-2px]" />
          {when.format("D MMM YYYY")}
          {upcoming ? ` · in ${when.fromNow(true)}` : ""}
        </p>
      </div>
    </article>
  );
}