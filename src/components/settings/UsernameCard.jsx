import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// The one name that is meant to be found. Whether it is free is decided by the server — no
// reader can read another reader's profile — and the field on the profile is then written by
// its owner, so nobody else can set it.
export default function UsernameCard() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    base44.auth
      .me()
      .then((me) => setUsername(me?.username || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const res = await base44.functions.invoke("readingCircle", {
        action: "username",
        username,
      });
      const claimed = res.data.username;
      await base44.auth.updateMe({ username: claimed });
      setUsername(claimed);
      setSaved(`Other readers can now find you as @${claimed}.`);
    } catch (err) {
      setError(err?.response?.data?.error || "That username couldn't be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Your username</h2>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        The name other readers can find you by. Letters, numbers and underscores, 3 to 20
        characters.
      </p>

      <form onSubmit={save} className="flex gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="yourname"
          disabled={loading}
          className="h-11 sm:h-9"
        />
        <Button type="submit" size="sm" disabled={loading || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </Button>
      </form>

      {saved && <p role="status" className="text-sm text-primary mt-2">{saved}</p>}
      {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
    </section>
  );
}