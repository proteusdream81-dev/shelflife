import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import PolicySection from "@/components/legal/PolicySection";
import { TERMS_META, TERMS_SECTIONS, TERMS_TITLE } from "@/lib/termsOfService";
import { applyShareMeta } from "@/lib/pageMeta";

// Public Terms page — reachable signed in or not, required for store listing and registration.
export default function TermsOfService() {
  const navigate = useNavigate();

  useEffect(() => {
    const previousTitle = document.title;
    applyShareMeta({
      title: "Terms of Service — ShelfLife",
      description:
        "The terms that govern your use of ShelfLife, including eligibility, content rules, affiliate links, and subscriptions.",
    });
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <FileText strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Terms of Service</span>
              </div>
            </div>
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
            {TERMS_TITLE}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">{TERMS_META}</p>

          <div className="mt-7 pt-7 border-t border-primary/20">
            {TERMS_SECTIONS.map((section, index) => (
              <PolicySection
                key={section.heading}
                heading={section.heading}
                blocks={section.blocks}
                last={index === TERMS_SECTIONS.length - 1}
              />
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="underline-offset-4 hover:text-primary hover:underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link to="/data-deletion" className="underline-offset-4 hover:text-primary hover:underline">
            Data deletion
          </Link>
        </p>
      </main>
    </div>
  );
}
