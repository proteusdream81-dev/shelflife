import React, { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { joinWaitlist } from "@/lib/waitlistSignup";

const FIELD =
  "h-11 w-full rounded-xl border border-primary/30 bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary";

// The beta page's own capture: one address, saved to the same list the waitlist uses, so a tester
// who wants the link emailed can be written to without hunting for the page again.
export default function BetaSignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      await joinWaitlist({ email, source: "beta", foundingTester: true });
      setStatus("done");
    } catch (exception) {
      setError(exception.message);
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="vp-panel p-5 text-center" role="status">
        <CheckCircle2 className="w-7 h-7 text-primary mx-auto" strokeWidth={1.9} />
        <h3 className="mt-2 font-heading text-lg text-foreground">One tap left</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We've sent a confirmation link to {email || "you"}. Tap it and the test build lands in
          your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="vp-panel p-4 sm:p-5 space-y-3">
      <h2 className="font-heading text-xl text-foreground">
        Get beta news and the opt-in link by email
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Not near your Android phone, or want the link waiting in your inbox? Leave your address and
        we'll send it over.
      </p>

      <label htmlFor="beta-email" className="block text-xs font-semibold text-muted-foreground">
        Email
      </label>
      <input
        id="beta-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        maxLength={254}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className={FIELD}
      />

      <button
        type="submit"
        disabled={status === "sending"}
        className="vp-btn vp-primary w-full justify-center disabled:opacity-70"
      >
        {status === "sending" && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === "sending" ? "Saving..." : "Send me the opt-in link"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Beta news and the testing link only. No spam, and you can ask us to remove your address at
        any time.
      </p>
    </form>
  );
}