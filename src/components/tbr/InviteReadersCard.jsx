import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus } from "lucide-react";

export default function InviteReadersCard({ groupId, memberIds, onChanged }) {
  const [circle, setCircle] = useState([]);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Readers you follow, and readers who follow you, are the circle you can invite from.
  useEffect(() => {
    base44.functions
      .invoke("readingCircle", { action: "overview" })
      .then(({ data }) => {
        const all = [...(data.following || []), ...(data.followers || [])];
        setCircle(Array.from(new Map(all.map((reader) => [reader.id, reader])).values()));
      })
      .catch(() => {});
  }, []);

  const invite = async (userId) => {
    setBusy(userId);
    setError("");
    try {
      const { data } = await base44.functions.invoke("bookGroups", {
        action: "invite",
        group_id: groupId,
        user_id: userId,
      });
      onChanged(data.members || []);
    } catch (err) {
      setError(err?.response?.data?.error || "That invite didn't go through — please try again.");
    } finally {
      setBusy("");
    }
  };

  const search = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSearching(true);
    setError("");
    setFound([]);
    try {
      const { data } = await base44.functions.invoke("readingCircle", { action: "search", email });
      setFound(data.readers || []);
    } catch (err) {
      setError(err?.response?.data?.error || "That search didn't go through — please try again.");
    } finally {
      setSearching(false);
    }
  };

  const candidates = circle.filter((reader) => !memberIds.includes(reader.id));
  const roster = [...candidates, ...found.filter((r) => !candidates.some((c) => c.id === r.id))];

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Invite readers</h2>
        </div>
      </div>

      <form onSubmit={search} className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their email address..."
          className="h-10"
        />
        <Button type="submit" size="sm" disabled={searching}>
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
        </Button>
      </form>

      <div className="space-y-2 mt-3">
        {roster.map((reader) => (
          <div
            key={reader.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/20 bg-secondary/40"
          >
            <p className="text-sm font-medium min-w-0 truncate">{reader.name}</p>
            {memberIds.includes(reader.id) ? (
              <Badge variant="secondary">Invited</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => invite(reader.id)} disabled={busy === reader.id}>
                {busy === reader.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Invite
              </Button>
            )}
          </div>
        ))}

        {roster.length === 0 && (
          <p className="vp-empty">
            Everyone in your reading circle is already here — find another reader by email above.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}