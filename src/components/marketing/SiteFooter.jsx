import React from "react";
import { Link } from "react-router-dom";
import { DATA_DELETION_EMAIL } from "@/lib/dataDeletion";
import { SITE_URL } from "@/lib/siteUrl";

// The foot of the public site: who runs it, and the pages a visitor, a store or a crawler looks
// for. Real links rather than a line of text, so each is a single tap from the front page.
const LINK_CLASS = "underline decoration-current/40 underline-offset-4 hover:text-primary";

export default function SiteFooter() {
  return (
    <footer className="mx-auto max-w-5xl px-2 pb-4 text-center text-xs text-muted-foreground">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Link to="/privacy-policy" className={LINK_CLASS}>Privacy Policy</Link>
        <Link to="/terms" className={LINK_CLASS}>Terms of Service</Link>
        <Link to="/data-deletion" className={LINK_CLASS}>Data Deletion</Link>
        <Link to="/beta" className={LINK_CLASS}>Founding Testers</Link>
        <a href={`mailto:${DATA_DELETION_EMAIL}`} className={LINK_CLASS}>Contact</a>
      </nav>
      <p className="mt-3">
        <a
          href={SITE_URL}
          className="text-foreground/80 underline underline-offset-4 hover:text-primary"
        >
          ShelfLife · Justin Schrader
        </a>
      </p>
    </footer>
  );
}
