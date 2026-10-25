import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import PolicySection from "@/components/legal/PolicySection";
import { POLICY_META, POLICY_SECTIONS, POLICY_TITLE } from "@/lib/privacyPolicy";
import { applyShareMeta } from "@/lib/pageMeta";

// The policy Play asks for: one address any reader can open, signed in or not. Nothing on this
// page does anything but show the text, so it carries no app state and no protected requests.
export default function PrivacyPolicy() {
  const navigate = useNavigate();

  // A link to the policy should preview as the policy, not as the reading list.
  useEffect(() => {
    const previousTitle = document.title;
    applyShareMeta({
      title: "Privacy Policy — ShelfLife",
      description:
        "How ShelfLife collects, uses, discloses and safeguards your information, and how to delete your account and data.",
    });
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Reached from Settings or the login screen, this goes back where the reader came from; opened
  // from outside the app, it hands them to the app itself.
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
                <ShieldCheck strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Privacy Policy</span>
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
            {POLICY_TITLE}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">{POLICY_META}</p>

          <div className="mt-7 pt-7 border-t border-primary/20">
            {POLICY_SECTIONS.map((section, index) => (
              <PolicySection
                key={section.heading}
                heading={section.heading}
                blocks={section.blocks}
                last={index === POLICY_SECTIONS.length - 1}
              />
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/data-deletion" className="underline-offset-4 hover:text-primary hover:underline">
            How to delete your account and data
          </Link>
        </p>
      </main>
    </div>
  );
}