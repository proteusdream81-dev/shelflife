import React, { lazy, Suspense } from "react";
import { useAuth } from "@/lib/AuthContext";
import AppSpinner from "@/components/AppSpinner";

const Home = lazy(() => import("@/pages/Home"));
const Waitlist = lazy(() => import("@/pages/Waitlist"));

// The root serves two audiences. A reader who is signed in goes straight to their shelves; someone
// who has never heard of ShelfLife gets the public landing page and its waitlist. Neither has to
// wait behind the other, because the auth check has already settled by the time this renders.
export default function Root() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<AppSpinner />}>
      {isAuthenticated ? <Home /> : <Waitlist />}
    </Suspense>
  );
}