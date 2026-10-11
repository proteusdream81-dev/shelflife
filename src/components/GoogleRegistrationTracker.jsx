import { useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackGoogleRegistration } from "@/lib/registrationEvents";

// Mounted once inside the auth provider, so it sees the reader the moment their
// account is resolved after returning from Google.
export default function GoogleRegistrationTracker() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) trackGoogleRegistration(user);
  }, [user]);

  return null;
}