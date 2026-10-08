import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, Navigation } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import PlaceCard from "@/components/tbr/PlaceCard";

const RADII = [
  { value: "2000", label: "2 km" },
  { value: "5000", label: "5 km" },
  { value: "10000", label: "10 km" },
  { value: "25000", label: "25 km" },
  { value: "50000", label: "50 km" },
];

const FILTERS = [
  { value: "all", label: "All" },
  { value: "library", label: "Libraries" },
  { value: "bookshop", label: "Bookshops" },
];

const getPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject({ code: 2 }); return; }
  navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000, maximumAge: 300000 });
});

export default function NearMe() {
  const [radius, setRadius] = useState("10000");
  const [filter, setFilter] = useState("all");
  const [coords, setCoords] = useState(null);
  const [places, setPlaces] = useState([]);
  const [status, setStatus] = useState("locating");
  const [error, setError] = useState("");

  const lookup = async (value, point) => {
    setStatus("loading");
    setError("");
    try {
      const res = await base44.functions.invoke("nearbyPlaces", {
        lat: point.lat,
        lon: point.lon,
        radius: Number(value),
      });
      setPlaces(res.data.places || []);
      setStatus("ready");
    } catch {
      setError("We couldn't load nearby places. Please try again.");
      setStatus("error");
    }
  };

  const locate = async () => {
    setStatus("locating");
    setError("");
    try {
      const position = await getPosition();
      const point = {
        lat: Number(position.coords.latitude.toFixed(5)),
        lon: Number(position.coords.longitude.toFixed(5)),
      };
      setCoords(point);
      await lookup(radius, point);
    } catch (e) {
      setError(e?.code === 1
        ? "ShelfLife needs your location to show libraries and bookshops nearby. Allow location access for this app, then try again."
        : "We couldn't get your location right now. Please try again.");
      setStatus("error");
    }
  };

  useEffect(() => { locate(); }, []);

  const changeRadius = (value) => {
    setRadius(value);
    if (coords) lookup(value, coords);
  };

  const shown = places.filter((p) => filter === "all" || p.kind === filter);
  const counts = {
    all: places.length,
    library: places.filter((p) => p.kind === "library").length,
    bookshop: places.filter((p) => p.kind === "bookshop").length,
  };
  const busy = status === "locating" || status === "loading";
  const emptyLabel = filter === "library" ? "libraries" : filter === "bookshop" ? "bookshops" : "libraries or bookshops";

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="vp-brand">
              <div className="vp-mark">
                <MapPin strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>Near me</strong>
                <span>Libraries and bookshops around you</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <h2>Within reach</h2>
              {status === "ready" && <span className="vp-badge">{places.length}</span>}
            </div>
            <div className="vp-shelfops">
              <Select value={radius} onValueChange={changeRadius}>
                <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RADII.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={locate} disabled={busy} title="Update my location" aria-label="Update my location">
                {status === "locating" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`vp-btn vp-small ${filter === f.value ? "vp-active" : ""}`}
              >
                {f.label} <span className="opacity-70">{counts[f.value]}</span>
              </button>
            ))}
          </div>

          {busy && (
            <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">
                {status === "locating" ? "Finding your location..." : "Looking for libraries and bookshops..."}
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="vp-empty">
              <p>{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={locate}>Try again</Button>
            </div>
          )}

          {status === "ready" && shown.length === 0 && (
            <p className="vp-empty">No {emptyLabel} found nearby. Try a wider distance.</p>
          )}

          {status === "ready" && shown.length > 0 && (
            <div className="space-y-3">
              {shown.map((place) => <PlaceCard key={place.id} place={place} />)}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-5">
            Place data from OpenStreetMap contributors{coords ? ", sorted by distance from you" : ""}.
          </p>
        </section>
      </main>
    </div>
  );
}