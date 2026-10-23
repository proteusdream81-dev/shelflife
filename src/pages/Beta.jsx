import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Smartphone } from "lucide-react";
import BetaSteps, { BETA_OPT_IN_URL } from "@/components/beta/BetaSteps";
import BetaPerks from "@/components/beta/BetaPerks";
import BetaSignupForm from "@/components/beta/BetaSignupForm";

// The recruitment page for the closed Android beta: one job, three steps, and a way to leave an
// address if the reader isn't holding their phone right now. Public — no account needed.
export default function Beta() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Become a Founding Tester — ShelfLife";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="vp-page lp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <Link to="/" className="vp-brand">
              <div className="vp-mark">
                <BookOpen strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Your reading life</span>
              </div>
            </Link>
            <div className="vp-actions">
              <Link to="/login" className="vp-btn">
                Log in
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-primary">
            Closed beta · Android
          </p>
          <h1 className="mt-3 font-heading text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            Become a Founding Tester of ShelfLife
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Get ShelfLife on your phone before the public launch, carry a Founding Tester badge on
            your profile, and have a direct hand in what we build next. Testing is free, takes a
            couple of minutes to set up, and your shelves are yours to keep.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={BETA_OPT_IN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="vp-btn vp-primary justify-center"
            >
              <Smartphone />
              Open the tester link
            </a>
            <a href="#beta-signup" className="vp-btn justify-center">
              Send it to my inbox
            </a>
          </div>
        </section>

        <BetaSteps />

        <BetaPerks />

        <div id="beta-signup" className="scroll-mt-24">
          <BetaSignupForm />
        </div>

        <footer className="pt-1 text-center text-xs text-muted-foreground">
          <a
            href="https://shelflifetbr.com"
            className="text-foreground/80 underline underline-offset-4 hover:text-primary"
          >
            Justin Schrader · shelflifetbr.com
          </a>
        </footer>
      </main>
    </div>
  );
}