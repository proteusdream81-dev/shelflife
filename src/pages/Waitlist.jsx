import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Download, Smartphone } from "lucide-react";
import WaitlistForm from "@/components/marketing/WaitlistForm";
import ShelfShowcase from "@/components/marketing/ShelfShowcase";
import FeatureBlurbs from "@/components/marketing/FeatureBlurbs";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PLAY_STORE_URL } from "@/lib/reviewPrompt";

// The public front door: what ShelfLife is, and the one thing a visitor can do about it today.
// A reader with an account never lands here — the root hands them their shelves instead.
export default function Waitlist() {
  useEffect(() => {
    const previous = document.title;
    document.title = "ShelfLife — The book tracker that looks like your real shelf";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="vp-page lp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-5xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <BookOpen strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Your reading life</span>
              </div>
            </div>
            <div className="vp-actions">
              <Link to="/beta" className="vp-btn">
                <Smartphone />
                Founding Tester
              </Link>
              <Link to="/login" className="vp-btn">
                Log in
              </Link>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="vp-btn vp-primary"
              >
                <Download />
                Google Play
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="vp-main max-w-5xl mx-auto">
        <section className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-primary">
              Early access
            </p>
            <h1 className="mt-3 font-heading text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl">
              The book tracker that looks like your real shelf
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Scan a barcode and the book lands on a shelf worth looking at. Import your Goodreads
              library, rate the spice, and hand a shelf to a friend.
            </p>
            <div className="mt-6">
              <WaitlistForm />
            </div>
          </div>

          <ShelfShowcase />
        </section>

        <FeatureBlurbs />

        <section className="vp-shelf text-center">
          <h2 className="font-heading text-2xl text-foreground">Take the shelf with you</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            ShelfLife is in early access on Android. Join the list above, or start shelving now.
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="vp-btn vp-primary"
            >
              <Download />
              Get it on Google Play
            </a>
            <Link to="/login" className="vp-btn">
              I have an account
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            On Android and want in today?{" "}
            <Link to="/beta" className="text-primary underline underline-offset-4">
              Become a Founding Tester
            </Link>
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}