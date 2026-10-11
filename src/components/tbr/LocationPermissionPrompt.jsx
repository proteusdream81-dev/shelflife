import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const SEEN_KEY = "shelflife.locationAsked";
const ASK_TIMEOUT_MS = 12000;

// A device only offers its location prompt when the app actually asks, so the app asks on the
// first screen a reader sees instead of waiting until they open the Near me tab.
export default function LocationPermissionPrompt() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Nothing to remember it with — the card simply won't show again in this session.
    }
    setBusy(false);
    setAsking(false);
  };

  const allow = () => {
    if (!navigator.geolocation) {
      dismiss();
      return;
    }
    setBusy(true);
    // Whether the device answers or stays silent, the ask resolves itself, so this can
    // never leave a reader (or a test run) waiting on a spinner that never ends.
    const settle = () => dismiss();
    try {
      navigator.geolocation.getCurrentPosition(settle, settle, { timeout: ASK_TIMEOUT_MS });
      setTimeout(settle, ASK_TIMEOUT_MS + 1500);
    } catch {
      settle();
    }
  };

  useEffect(() => {
    if (!user || pathname.startsWith("/share")) return;
    let seen = false;
    try {
      seen = Boolean(localStorage.getItem(SEEN_KEY));
    } catch {
      seen = true;
    }
    if (!seen) setAsking(true);
  }, [user, pathname]);

  // A permission the reader already granted needs no asking.
  useEffect(() => {
    if (!asking) return;
    let cancelled = false;
    try {
      navigator.permissions
        ?.query({ name: "geolocation" })
        .then((status) => {
          if (!cancelled && status.state === "granted") dismiss();
        })
        .catch(() => {});
    } catch {
      // No permission lookup here — the reader can just answer the card.
    }
    return () => {
      cancelled = true;
    };
  }, [asking]);

  if (!asking) return null;

  return (
    // A nudge above the tab bar, never a gate: the backdrop lets taps through, so it can
    // never stand between the reader and the page behind it.
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
      style={{ bottom: "calc(84px + env(safe-area-inset-bottom, 0px))" }}
      role="region"
      aria-label="Location permission"
    >
      <div className="vp-panel pointer-events-auto w-full max-w-sm p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="vp-mark shrink-0">
            <MapPin strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Turn on location?</p>
            <p className="text-xs text-muted-foreground mt-1">
              ShelfLife uses it to show the libraries and bookshops around you in Near me.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="vp-btn vp-icon shrink-0"
            aria-label="Dismiss location nudge"
          >
            <X strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex gap-2 mt-3">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Not now
          </Button>
          <Button className="flex-1" onClick={allow} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Allow location"}
          </Button>
        </div>
      </div>
    </div>
  );
}