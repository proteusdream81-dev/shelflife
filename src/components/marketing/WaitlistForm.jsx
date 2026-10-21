import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, Loader2 } from "lucide-react";

// A native form first: with scripts off the browser posts the fields itself and the endpoint
// answers with a finished page. With scripts on, the same submit is taken over for an inline reply.
const FORM_ENDPOINT = "https://meek-shelflife-reader-hub.base44.app/functions/joinWaitlist";

const FIELD =
  "h-11 w-full rounded-xl border border-primary/30 bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary";

export default function WaitlistForm({ source = "landing" }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const res = await base44.functions.invoke("joinWaitlist", {
        email,
        name,
        source,
        founding_tester_consent: consent,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      setStatus("done");
    } catch {
      setError("We couldn't add you just now. Please try again.");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="vp-panel p-5 text-center" role="status">
        <CheckCircle2 className="w-7 h-7 text-primary mx-auto" strokeWidth={1.9} />
        <h3 className="mt-2 font-heading text-lg text-foreground">You're on the list</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll email {email || "you"} the moment ShelfLife is live on Google Play.
        </p>
      </div>
    );
  }

  return (
    <form
      method="post"
      action={FORM_ENDPOINT}
      onSubmit={submit}
      className="vp-panel p-4 sm:p-5 space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="waitlist-name" className="block text-xs font-semibold text-muted-foreground mb-1.5">
            First name <span className="font-normal">(optional)</span>
          </label>
          <input
            id="waitlist-name"
            name="name"
            type="text"
            autoComplete="given-name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jodi"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="waitlist-email" className="block text-xs font-semibold text-muted-foreground mb-1.5">
            Email
          </label>
          <input
            id="waitlist-email"
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
        </div>
      </div>

      {/* A plain native checkbox: unticked by default, and a form post carries it without any script. */}
      <label
        htmlFor="waitlist-founding-tester"
        className="flex items-start gap-2.5 text-[12px] leading-snug text-foreground/90 cursor-pointer"
      >
        <input
          id="waitlist-founding-tester"
          name="founding_tester_consent"
          type="checkbox"
          value="on"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 flex-none accent-primary"
        />
        <span>Yes, make me a Founding Tester (free early access - keep it private)</span>
      </label>

      <input type="hidden" name="source" value={source} />

      <button
        type="submit"
        disabled={status === "sending"}
        className="vp-btn vp-primary w-full justify-center disabled:opacity-70"
      >
        {status === "sending" && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === "sending" ? "Adding you..." : "Join the waitlist"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        One email when the app is live. No spam, and you can ask us to remove your address at any time.
      </p>
    </form>
  );
}