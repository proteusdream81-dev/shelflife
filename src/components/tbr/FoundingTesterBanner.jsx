import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Smartphone } from "lucide-react";

// The Android closed-testing sign-up. A plain anchor, so the link works as native HTML and
// opens the Play testing page in its own tab, leaving ShelfLife where it was.
const TESTING_URL = "https://play.google.com/apps/testing/com.codelustre.shelflifeapp";

// The only two things that stop the banner, and both live on the reader's own record, so the
// answer is the same on every device and in every browser. Nothing here looks at how old the
// account is or whether a waitlist row exists: an account made before this banner shipped has
// neither flag set, and a missing flag counts as "not answered yet".
const alreadyAnswered = (user) =>
  user?.founding_tester_opted_in === true || user?.tester_prompt_dismissed === true;

// One ask on the reader's own shelf: become a Founding Tester on Android.
export default function FoundingTesterBanner() {
  const { user } = useAuth();
  const [answered, setAnswered] = useState(false);

  if (answered || alreadyAnswered(user)) return null;

  // Following the link IS the opt-in, so the banner does not ask again.
  const optIn = () => {
    setAnswered(true);
    base44.auth.updateMe({ founding_tester_opted_in: true }).catch(() => {});
  };

  // "Maybe later" is a real, persistent put-aside: it is written to the reader's record, so it
  // holds on their next visit and on their other devices.
  const dismiss = () => {
    setAnswered(true);
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