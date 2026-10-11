import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const SEEN_KEY = "shelflife.locationAsked";

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
    setAsking(false);
  };

  const allow = () => {
    if (!navigator.geolocation) {
      dismiss();
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setBusy(false);
        dismiss();
      },
      () => {
        setBusy(false);
        dismiss();
      },
      { timeout: 12000 }
    );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="vp-panel w-full max-w-sm p-5 text-center">
        <div className="vp-mark mx-auto mb-3">
          <MapPin strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold mb-2">Turn on location</h2>
        <p className="text-sm text-muted-foreground mb-4">
          ShelfLife uses your location to show the libraries and bookshops around you in Near me.
          Your device will ask you to confirm.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={dismiss} disabled={busy}>
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