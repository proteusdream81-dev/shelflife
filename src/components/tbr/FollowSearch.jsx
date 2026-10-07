import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export default function FollowSearch({ followingIds, onFollow }) {
  const [email, setEmail] = useState("");
  const [readers, setReaders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await base44.functions.invoke("readingCircle", { action: "search", email });
      setReaders(res.data.readers || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={search} className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their email address..."
          className="h-10"
        />
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Readers are matched on the exact email they use in this app.
      </p>

      {readers.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border border-border">
          <p className="text-sm font-medium min-w-0 line-clamp-1">{r.name}</p>
          {followingIds.includes(r.id) ? (
            <Badge variant="secondary">Following</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onFollow(r.id)}>Follow</Button>
          )}
        </div>
      ))}
      {searched && !loading && readers.length === 0 && (
        <p className="text-sm text-muted-foreground">No reader found with that email.</p>
      )}
    </form>
  );
}