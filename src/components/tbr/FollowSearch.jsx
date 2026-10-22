import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

// Finding a reader by the name they go by or the username they chose in Settings. Following
// one of them sends a request: the row says "Requested" until the other reader answers.
export default function FollowSearch({ onFollow }) {
  const [query, setQuery] = useState("");
  const [readers, setReaders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const search = async (e) => {
    e.preventDefault();
    const text = query.trim();
    if (text.length < 2) {
      setError("Type at least two letters of a name or username.");
      return;
    }
    setLoading(true);
    setSearched(true);
    setError("");
    try {
      const res = await base44.functions.invoke("readingCircle", { action: "search", query: text });
      setReaders(res.data.readers || []);
    } catch (err) {
      setReaders([]);
      setError(err?.response?.data?.error || "That search didn't go through — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const ask = async (reader) => {
    await onFollow(reader.id);
    setReaders((prev) => prev.map((r) => (r.id === reader.id ? { ...r, state: "pending" } : r)));
  };

  return (
    <form onSubmit={search} className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Their name or @username..."
          className="h-10"
        />
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Readers are matched on their name, or on the username they chose in Settings.
      </p>

      {readers.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/20 bg-secondary/40">
          <div className="min-w-0">
            <p className="text-sm font-medium line-clamp-1">{r.name}</p>
            {/* Name, username and what they share, so the profile is readable before the ask. */}
            <p className="text-xs text-muted-foreground line-clamp-1">
              {r.username ? `@${r.username}` : "No username yet"}
              <span className="mx-1.5 opacity-60">·</span>
              {r.shared_shelves > 0
                ? `${r.shared_shelves} shared shelf${r.shared_shelves === 1 ? "" : "s"}`
                : "Hasn't shared a shelf"}
            </p>
          </div>
          {r.state === "accepted" ? (
            <Badge variant="secondary">Following</Badge>
          ) : r.state === "pending" ? (
            <Badge variant="secondary">Requested</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => ask(r)}>Follow</Button>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {searched && !loading && !error && readers.length === 0 && (
        <p className="text-sm text-muted-foreground">No reader found with that name or username.</p>
      )}
    </form>
  );
}