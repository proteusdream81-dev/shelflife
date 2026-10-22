import { base44 } from "@/api/base44Client";

const PENDING_KEY = "shelflife:google-signup";
const FRESH_ACCOUNT_MS = 15 * 60 * 1000;

// Google hands the reader back already signed in and says nothing about whether
// it just created the account, so the click is remembered here and the account's
// own age settles it once we are back in the app.
export const markGoogleSignup = () => {
  try {
    sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Private browsing without storage: that sign-up simply goes uncounted.
  }
};

const takePendingGoogleSignup = () => {
  try {
    const pending = sessionStorage.getItem(PENDING_KEY) === "1";
    sessionStorage.removeItem(PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
};

const justCreated = (user) => {
  const created = new Date(user?.created_date || "").getTime();
  return Number.isFinite(created) && Date.now() - created < FRESH_ACCOUNT_MS;
};

// A web sign-up also joins the waitlist, so the Founding Tester invitation flow reaches it
// exactly as it reaches a landing-page signup. A failure here never blocks the registration
// the reader has already finished, so callers may await it without losing the account.
export const enrollInWaitlist = async (email, name = "") => {
  if (!email) return;
  try {
    await base44.functions.invoke("joinWaitlist", {
      email,
      name,
      source: "web-register",
    });
  } catch {
    // The account exists either way; only this signup's funnel entry is missed.
  }
};

// Counts a sign-up that came back from Google. Called once the reader is
// resolved; the pending flag is cleared either way, so a sign-in with an older
// account never counts as a registration.
export function trackGoogleRegistration(user) {
  if (!takePendingGoogleSignup() || !justCreated(user)) return;
  base44.analytics.track({ eventName: "user_registered" });
  enrollInWaitlist(user?.email, user?.full_name || "");
}