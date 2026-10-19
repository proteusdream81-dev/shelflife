import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import DeleteAccountCard from "@/components/profile/DeleteAccountCard";
import DeletionInfo from "@/components/account/DeletionInfo";
import DeletionRequestForm from "@/components/account/DeletionRequestForm";
import { DELETION_HEADLINE, DELETION_INTRO } from "@/lib/accountDeletionContent";

// The address Play asks every app to publish: any reader, signed in or not, can delete their
// account from here. A visitor who is not signed in is never sent to the login screen, and the
// page asks the app one question only, whether someone is already signed in, so it can offer the
// one-button version instead of the emailed code.
export default function AccountDeletion() {
  const navigate = useNavigate();
  const [reader, setReader] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const signedIn = await base44.auth.isAuthenticated();
        setReader(signedIn ? await base44.auth.me() : null);
      } catch {
        setReader(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Reached from Settings or from a link sent to someone, this goes back where the reader came
  // from; opened cold from outside the app, it hands them to the app itself.
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
                <Trash2 strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>ShelfLife</strong>
                <span>Account deletion</span>
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
          <h1 className="font-heading text-2xl sm:text-3xl tracking-tight text-foreground">
            {DELETION_HEADLINE}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{DELETION_INTRO}</p>
        </div>

        {!ready ? (
          <div className="vp-panel p-6 sm:p-8 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Checking whether you are signed in...
          </div>
        ) : reader ? (
          <div className="space-y-3">
            <p className="px-1 text-sm text-muted-foreground">
              You are signed in as {reader.email || "this account"}. Deleting ends this account and
              signs you out here.
            </p>
            <DeleteAccountCard userId={reader.id} onDeleted={() => base44.auth.logout("/")} />
          </div>
        ) : (
          <DeletionRequestForm />
        )}

        <DeletionInfo />

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="underline-offset-4 hover:text-primary hover:underline">
            Privacy Policy
          </Link>
        </p>
      </main>
    </div>
  );
}