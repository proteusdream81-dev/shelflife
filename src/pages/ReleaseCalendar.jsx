import React, { useEffect, useMemo, useState } from "react";
import moment from "moment";
import { base44 } from "@/api/base44Client";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CalendarDays, Loader2 } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import ReleaseCard from "@/components/tbr/ReleaseCard";
import ReleaseDetailDialog from "@/components/tbr/ReleaseDetailDialog";

export default function ReleaseCalendar() {
  const [releases, setReleases] = useState([]);
  const [authors, setAuthors] = useState({ scanned: 0, total: 0 });
  const [status, setStatus] = useState("loading");
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [openRelease, setOpenRelease] = useState(null);

  const load = async () => {
    setStatus("loading");
    try {
      const res = await base44.functions.invoke("authorReleases", {});
      setReleases(res.data.releases || []);
      setAuthors({ scanned: res.data.authors_scanned || 0, total: res.data.authors_total || 0 });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => { load(); }, []);

  const byDate = useMemo(() => {
    const map = {};
    releases.forEach((release) => {
      map[release.date] = map[release.date] || [];
      map[release.date].push(release);
    });
    return map;
  }, [releases]);

  const releaseDates = useMemo(
    () => Object.keys(byDate).map((key) => new Date(`${key}T00:00:00`)),
    [byDate]
  );

  const monthKey = moment(month).format("YYYY-MM");
  const monthReleases = releases.filter((release) => release.date.startsWith(monthKey));
  const dayReleases = selected ? byDate[moment(selected).format("YYYY-MM-DD")] || [] : [];
  const future = releases.filter((release) => moment(release.date).isSameOrAfter(moment(), "day"));
  const nextUp = (future.length > 0 ? future : [...releases].reverse()).slice(0, 6);
  const nextUpLabel = future.length > 0 ? "Coming up next" : "Recently released";
  const shown = selected ? dayReleases : monthReleases;

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark"><CalendarDays strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong>Release calendar</strong>
                <span>New books from your authors</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        {status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Checking your authors for release dates...
          </div>
        )}

        {status === "error" && (
          <section className="vp-shelf">
            <p className="vp-empty">
              We couldn't load release dates right now.
              <Button size="sm" variant="outline" className="mt-3" onClick={load}>Try again</Button>
            </p>
          </section>
        )}

        {status === "ready" && (
          <>
            <section className="vp-shelf">
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selected || undefined}
                  onSelect={(date) => setSelected(date || null)}
                  month={month}
                  onMonthChange={setMonth}
                  modifiers={{ hasRelease: releaseDates }}
                  modifiersClassNames={{ hasRelease: "day-release" }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                A gold dot marks a release date
              </p>
            </section>

            <section className="vp-shelf">
              <div className="vp-shelfhead">
                <div className="vp-titleline">
                  <h2 className="text-xl">{selected ? moment(selected).format("dddd D MMMM") : moment(month).format("MMMM YYYY")}</h2>
                  {shown.length > 0 && <span className="vp-badge">{shown.length}</span>}
                </div>
                {selected && (
                  <Button size="sm" variant="outline" onClick={() => setSelected(null)}>
                    Whole month
                  </Button>
                )}
              </div>

              {authors.total === 0 ? (
                <p className="vp-empty">
                  Add books to your list and any new releases from those authors will show up here.
                </p>
              ) : shown.length > 0 ? (
                <div className="space-y-3">
                  {shown.map((release) => (
                    <ReleaseCard key={release.id} release={release} onOpen={setOpenRelease} />
                  ))}
                </div>
              ) : (
                <>
                  <p className="vp-empty">
                    {selected ? "No release dates on this day." : "No release dates in this month."}
                  </p>
                  {!selected && nextUp.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{nextUpLabel}</p>
                      <div className="space-y-3">
                        {nextUp.map((release) => (
                          <ReleaseCard key={`next-up-${release.id}`} release={release} onOpen={setOpenRelease} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {authors.total > 0 && (
                <p className="text-xs text-muted-foreground mt-5">
                  Based on {authors.scanned} of {authors.total} authors on your list · dates from Open Library.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      <ReleaseDetailDialog
        release={openRelease}
        open={!!openRelease}
        onOpenChange={(next) => { if (!next) setOpenRelease(null); }}
      />
    </div>
  );
}