import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Trash2 } from "lucide-react";
import PolicyBlocks from "@/components/legal/PolicyBlocks";
import {
  DATA_DELETION_CONTACT,
  DATA_DELETION_HEADLINE,
  DATA_DELETION_INTRO,
  DATA_DELETION_MAILTO,
  DATA_DELETION_SECTIONS,
} from "@/lib/dataDeletion";
import { applyShareMeta } from "@/lib/pageMeta";

// The public address every store asks an app to publish: how to ask for your data to be deleted,
// what goes, what stays and how long it takes. It asks the app nothing and needs nobody signed in,
// so it opens for a visitor, a crawler and a reviewer alike.
export default function DataDeletion() {
  const navigate = useNavigate();

  // A link to this page should preview as the deletion page, not as the reading list.
  useEffect(() => {
    const previousTitle = document.title;
    applyShareMeta({
      title: "Data Deletion — ShelfLife",
      description:
        "How to request deletion of your ShelfLife account and data: what is deleted, what is retained, and how long it takes.",
    });
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Opened from the site it goes back where the visitor came from; opened cold from outside the
  // app, it offers the app itself instead of an empty history.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <Link to="/" className="vp-brand">
              <div className="vp-mark">
                <Trash2 strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Data deletion</span>
              </div>
            </Link>
            <div className="vp-actions">
              <button type="button" className="vp-btn vp-small" onClick={goBack}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <div className="vp-panel p-6 sm:p-8">
          <h1 className="font-heading uppercase text-2xl sm:text-3xl tracking-tight text-foreground">
            {DATA_DELETION_HEADLINE}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{DATA_DELETION_INTRO}</p>
          <a href={DATA_DELETION_MAILTO} className="vp-btn vp-primary mt-5">
            <Mail aria-hidden="true" />
            Request deletion by email
          </a>
        </div>

        {DATA_DELETION_SECTIONS.map((section) => (
          <div key={section.heading} className="vp-panel p-6 sm:p-8">
            <h2 className="font-heading text-xs uppercase tracking-[.18em] text-primary">
              {section.heading}
            </h2>
            <PolicyBlocks blocks={section.blocks} />
          </div>
        ))}

        <div className="vp-panel p-6 sm:p-8">
          <h2 className="font-heading text-xs uppercase tracking-[.18em] text-primary">
            {DATA_DELETION_CONTACT.heading}
          </h2>
          <PolicyBlocks blocks={DATA_DELETION_CONTACT.blocks} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/privacy-policy" className="underline-offset-4 hover:text-primary hover:underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link to="/delete-account" className="underline-offset-4 hover:text-primary hover:underline">
            Delete an account
          </Link>
        </p>
      </main>
    </div>
  );
}