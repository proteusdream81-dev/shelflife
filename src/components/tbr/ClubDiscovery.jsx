import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Search } from "lucide-react";
import CategoryChips from "@/components/tbr/CategoryChips";
import PublicClubRow from "@/components/tbr/PublicClubRow";

// Clubs that run outside the app — in libraries, bookshops, community centres and online.
// They are looked up in public listings, so every result opens the club's own page, and a
// reader who likes the look of one can start its equal inside ShelfLife.
export default function ClubDiscovery({ onStartLike }) {
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [clubs, setClubs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (event) => {
    event.preventDefault();
    if (!category && !location.trim()) {
      setError("Pick a subject, or type a place, to search.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { data } = await base44.functions.invoke("discoverBookClubs", {
        category,
        location: location.trim(),
      });
      setClubs(data.clubs || []);
    } catch (err) {
      setError(err?.response?.data?.error || "We could not look up clubs just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Find a club near you</h2>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        Clubs running in the world that are open to new members. Pick a subject, add a place if
        you want one nearby, and search. Opening a club takes you to its own page, where you join.
      </p>

      <form onSubmit={search} className="space-y-3">
        <CategoryChips value={category} onChange={setCategory} allLabel="Any subject" />
        <div className="vp-search">
          <MapPin />
          <input
            className="vp-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Town or city (optional)"
            aria-label="Town or city"
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          Search clubs
        </Button>
      </form>

      {busy && (
        <p className="text-xs text-muted-foreground mt-3">
          Reading public listings for clubs — this takes a few seconds.
        </p>
      )}
      {error && !busy && <p className="text-sm text-destructive mt-3">{error}</p>}

      {clubs && !busy && (
        clubs.length === 0 ? (
          <p className="vp-empty mt-4">
            Nothing came back for that. Try another subject, or a bigger place.
          </p>
        ) : (
          <div className="space-y-3 mt-4">
            {clubs.map((club) => (
              <PublicClubRow key={club.url} club={club} onStartLike={onStartLike} />
            ))}
          </div>
        )
      )}
    </section>
  );
}