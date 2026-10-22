import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Smartphone } from "lucide-react";

// The Android closed-testing sign-up. A plain anchor, so the link works as native HTML and
// opens the Play testing page in its own tab, leaving ShelfLife where it was.
const TESTING_URL = "https://play.google.com/apps/testing/com.codelustre.shelflifeapp";
const SNOOZE_KEY = "shelflife:tester-banner-snoozed";

const snoozed = () => {
  try {
    return sessionStorage.getItem(SNOOZE_KEY) === "1";
  } catch {
    return false;
  }
};

// One ask on the reader's own shelf: become a Founding Tester on Android. It stops for good
// only once they take that step; "Maybe later" just quiets it for the rest of the visit.
export default function FoundingTesterBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (snoozed()) return;
    base44.auth
      .me()
      .then((user) => setShow(!user?.founding_tester_opted_in))
      .catch(() => setShow(false));
  }, []);

  if (!show) return null;

  // Following the link IS the opt-in, so the banner does not ask again.
  const optIn = () => {
    setShow(false);
    base44.auth.updateMe({ founding_tester_opted_in: true }).catch(() => {});
  };

  // A deferral, not a refusal: it is remembered on the reader's record for this visit, and the
  // banner keeps its one ask on the next one.
  const dismiss = () => {
    setShow(false);
    try {
      sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      // No storage in private browsing: the banner simply hides for this page view.
    }
    base44.auth.updateMe({ tester_prompt_dismissed: true }).catch(() => {});
  };

  return (
    <section
      aria-labelledby="founding-tester-title"
      className="vp-panel relative overflow-hidden p-4 sm:p-5"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="vp-mark shrink-0" aria-hidden="true">
          <Smartphone strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="founding-tester-title"
            className="font-heading text-lg leading-tight text-foreground"
          >
            Become a Founding Tester
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            You're in early. Become a Founding Tester on Android — get the Android app first and
            help shape ShelfLife.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href={TESTING_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={optIn}
              className="vp-btn vp-primary"
            >
              <Smartphone />
              Become a Founding Tester
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}