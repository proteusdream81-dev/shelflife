import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { User as UserIcon } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import ProfileHeader from "@/components/profile/ProfileHeader";
import PrivacyCard from "@/components/profile/PrivacyCard";
import DeleteAccountCard from "@/components/profile/DeleteAccountCard";

export default function Profile() {
  const { user, logout } = useAuth();
  const [me, setMe] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const current = await base44.auth.me();
        setMe(current);
        setHidden(!!current?.profile_hidden);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleHidden = async () => {
    const next = !hidden;
    setSaving(true);
    try {
      await base44.auth.updateMe({ profile_hidden: next });
      setHidden(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="vp-brand">
              <div className="vp-mark">
                <UserIcon strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>My profile</strong>
                <span>Your account and privacy</span>
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
        <PrivacyCard hidden={hidden} saving={saving || loading} onToggle={toggleHidden} />
        <DeleteAccountCard userId={(me || user)?.id} onDeleted={() => logout()} />
      </main>
    </div>
  );
}