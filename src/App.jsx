import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import BackGuard from "@/components/BackGuard";
// Pages download on demand, so the first screen paints sooner on mobile webviews
const Home = lazy(() => import("@/pages/Home"));
const Share = lazy(() => import("@/pages/Share"));
const Friends = lazy(() => import("@/pages/Friends"));
const NearMe = lazy(() => import("@/pages/NearMe"));
const Profile = lazy(() => import("@/pages/Profile"));
const BookGroups = lazy(() => import("@/pages/BookGroups"));
const ReleaseCalendar = lazy(() => import("@/pages/ReleaseCalendar"));
const BookGroupRoom = lazy(() => import("@/pages/BookGroupRoom"));
const BookClubHost = lazy(() => import("@/pages/BookClubHost"));
const ReaderLibrary = lazy(() => import("@/pages/ReaderLibrary"));
const AuthorPage = lazy(() => import("@/pages/AuthorPage"));
import RouteTransition from "@/components/RouteTransition";
import AppSpinner from "@/components/AppSpinner";
import LocationPermissionPrompt from "@/components/tbr/LocationPermissionPrompt";
import GoogleRegistrationTracker from "@/components/GoogleRegistrationTracker";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Navigate, useLocation } from "react-router-dom";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <AppSpinner />
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <RouteTransition>
    <Suspense fallback={<AppSpinner />}>
    <Routes location={location}>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/share/:token" element={<Share />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/" element={<Home />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/friends/:readerId" element={<ReaderLibrary />} />
        <Route path="/near-me" element={<NearMe />} />
        <Route path="/book-groups" element={<BookGroups />} />
        <Route path="/book-groups/:id" element={<BookGroupRoom />} />
        <Route path="/book-clubs" element={<BookClubHost />} />
        <Route path="/releases" element={<ReleaseCalendar />} />
        <Route path="/author/:name" element={<AuthorPage />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
    <LocationPermissionPrompt />
    <GoogleRegistrationTracker />
    </RouteTransition>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <BackGuard />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App