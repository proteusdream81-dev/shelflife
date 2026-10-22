import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Settings as SettingsIcon } from "lucide-react";
import { Link } from "react-router-dom";
import AppNav from "@/components/tbr/AppNav";
import ProfileHeader from "@/components/profile/ProfileHeader";
import PrivacyCard from "@/components/profile/PrivacyCard";
import DisplayCard from "@/components/settings/DisplayCard";
import StorefrontCard from "@/components/settings/StorefrontCard";
import DeleteAccountCard from "@/components/profile/DeleteAccountCard";
import ImportCard from "@/components/settings/ImportCard";
import UsernameCard from "@/components/settings/UsernameCard";
import FollowersCard from "@/components/settings/FollowersCard";

// Everything that isn't reading: the account, what other readers can see, and bringing an
// existing library across. The shelf screen is left to the shelves themselves.
export default function Settings() {
  const { user, logout } = useAuth();
  const [me, setMe] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hideCovers, setHideCovers] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const current = await base44.auth.me();
        setMe(current);
        setHidden(!!current?.profile_hidden);
        setHideCovers(current?.hide_covers === true);
        setShowWarnings(current?.show_content_warnings === true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Optimistic: flip the switch straight away, roll back if the save fails.
  const toggleHidden = async () => {
    const next = !hidden;
    setHidden(next);
    setSaving(true);
    setError("");
    try {
      await base44.auth.updateMe({ profile_hidden: next });
    } catch {
      setHidden(!next);
      setError("We couldn't save that change. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // The display switches behave the same way: flip first, and put it back if the save fails.
  const savePreference = async (field, value) => {
    const previous = field === "hide_covers" ? hideCovers : showWarnings;
    const apply = (next) => (field === "hide_covers" ? setHideCovers(next) : setShowWarnings(next));
    apply(value);
    setSavingKey(field);
    setError("");
    try {
      await base44.auth.updateMe({ [field]: value });
    } catch {
      apply(previous);
      setError("We couldn't save that change. Please try again.");
    } finally {
      setSavingKey("");
    }
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark">
                <SettingsIcon strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>Settings</strong>
                <span>Your account, privacy and library</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <ProfileHeader
          name={me?.full_name || user?.full_name}
          email={me?.email || user?.email}
          onSignOut={() => logout()}
        />
        <UsernameCard />
        <FollowersCard />
        <ImportCard />
        <PrivacyCard
          hidden={hidden}
          saving={saving}
          disabled={loading}
          error={error}
          onToggle={toggleHidden}
        />
        <DisplayCard
          hideCovers={hideCovers}
          showWarnings={showWarnings}
          savingKey={savingKey}
          disabled={loading}
          error={error}
          onToggle={savePreference}
        />
        <StorefrontCard />
        <DeleteAccountCard userId={(me || user)?.id} onDeleted={() => logout()} />

        <p className="text-center text-xs text-muted-foreground">
          Deleting from a browser, or need a link to send someone?{" "}
          <Link to="/account-deletion" className="underline-offset-4 hover:text-primary hover:underline">
            Account deletion page
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="underline-offset-4 hover:text-primary hover:underline">
            Privacy Policy
          </Link>
        </p>
      </main>
    </div>
  );
}