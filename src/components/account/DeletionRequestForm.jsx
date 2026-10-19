import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { CheckCircle2, Loader2 } from "lucide-react";

const RESEND_SECONDS = 60;

// The deletion route for a visitor who is not signed in: they name the address their account uses,
// a code goes to that address, and answering with the code deletes the account. The page says the
// same thing whether or not the address has an account here, and the server decides the rest.
export default function DeletionRequestForm() {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (!wait) return undefined;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const askForCode = async (event) => {
    event?.preventDefault();
    if (loading || wait) return;
    setError("");
    setLoading(true);
    try {
      await base44.functions.invoke("accountDeletion", { action: "request", email: email.trim() });
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch {
      setError("We couldn't reach ShelfLife just now. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (event) => {
    event?.preventDefault();
    if (loading || code.length < 6) return;
    setError("");
    setLoading(true);
    try {
      await base44.functions.invoke("accountDeletion", {
        action: "confirm",
        email: email.trim(),
        code,
      });
      setStep("done");
    } catch (err) {
      setError(err?.response?.data?.error || "That code is not correct, or it has expired.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <section className="vp-panel p-6 sm:p-8">
        <h2 className="font-heading text-xl sm:text-2xl tracking-tight flex items-center gap-2 text-foreground">
          <CheckCircle2 className="w-5 h-5 text-primary" aria-hidden="true" />
          Your account is deleted
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          Everything ShelfLife held for that address is gone, including the shelves, books, ratings,
          notes and connections. There is nothing left to sign into, and nothing can be restored.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          A browser or a phone that had you signed in may keep offering the old sign-in for a few
          minutes. You can close this page once you are done.
        </p>
        <Button asChild className="mt-6 h-11">
          <Link to="/">Back to ShelfLife</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="vp-panel p-6 sm:p-8">
      <h2 className="font-heading text-xl sm:text-2xl tracking-tight text-foreground">
        {step === "email" ? "Delete your account by email" : "Enter your verification code"}
      </h2>

      <p className="mt-3 text-sm leading-relaxed text-foreground/85">
        {step === "email"
          ? "Not signed in, or using a device you would rather not sign in on? Tell us the email address your ShelfLife account uses, and we will send a 6-digit code to it."
          : `If a ShelfLife account exists for ${email}, a code is on its way to that address. It expires in 15 minutes.`}
      </p>

      {error && (
        <p role="alert" className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </p>
      )}

      {step === "email" ? (
        <form onSubmit={askForCode} className="mt-5 space-y-2">
          <Label htmlFor="deletion-email">Email address</Label>
          <Input
            id="deletion-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12"
            required
          />
          <Button
            type="submit"
            className="w-full h-12 font-medium"
            disabled={loading || !email.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Sending code...
              </>
            ) : (
              "Send my verification code"
            )}
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} className="mt-5 space-y-4">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              autoFocus
              autoComplete="one-time-code"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            type="submit"
            variant="destructive"
            className="w-full h-12 font-medium"
            disabled={loading || code.length < 6}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              "Verify code and delete my account"
            )}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Use a different address
            </button>
            <button
              type="button"
              className="text-primary font-medium hover:underline disabled:opacity-60 disabled:no-underline"
              disabled={wait > 0 || loading}
              onClick={askForCode}
            >
              {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
            </button>
          </div>
        </form>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Nothing has changed until you enter the code. If the address you type has no ShelfLife
        account, no code is sent and nothing is deleted.
      </p>
    </section>
  );
}