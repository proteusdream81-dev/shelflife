// The public signup endpoint. A visitor reading the landing page has no account, so the request
// is a plain fetch to the function rather than an SDK call: nothing here needs a signed-in reader,
// and the function itself answers with CORS for any origin. The same address is the form's own
// action, so a browser with scripts blocked saves the signup the same way.
export const WAITLIST_ENDPOINT = "https://meek-shelflife-reader-hub.base44.app/functions/joinWaitlist";

export async function joinWaitlist({ email, name = "", source = "landing", foundingTester = false }) {
  const response = await fetch(WAITLIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      name,
      source,
      founding_tester_consent: foundingTester,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error || "We couldn't add you just now. Please try again.");
  }
  return data;
}