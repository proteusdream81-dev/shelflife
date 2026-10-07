import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import FollowSearch from "@/components/tbr/FollowSearch";
import ReaderCard from "@/components/tbr/ReaderCard";
import ReaderLibraryDialog from "@/components/tbr/ReaderLibraryDialog";

export default function Friends() {
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [myShelves, setMyShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reader, setReader] = useState(null);

  const load = async () => {
    const res = await base44.functions.invoke("readingCircle", { action: "overview" });
    setFollowing(res.data.following || []);
    setFollowers(res.data.followers || []);
  };

  useEffect(() => {
    (async () => {
      try {
        setMyShelves(await base44.entities.Shelf.list("-created_date"));
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const follow = async (userId) => {
    await base44.functions.invoke("readingCircle", { action: "follow", user_id: userId });
    await load();
  };

  const unfollow = async (userId) => {
    await base44.functions.invoke("readingCircle", { action: "unfollow", user_id: userId });
    await load();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight leading-none">Reading circle</h1>
            <p className="text-xs text-muted-foreground">Follow readers and browse the shelves they share</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Find a reader</h2>
          <FollowSearch followingIds={following.map((f) => f.id)} onFollow={follow} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Following ({following.length})
          </h2>
          {following.length === 0 ? (
            <p className="text-sm text-muted-foreground">You're not following anyone yet.</p>
          ) : (
            following.map((r) => (
              <ReaderCard key={r.id} reader={r} onView={setReader} onUnfollow={unfollow} />
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Followers ({followers.length})
          </h2>
          {followers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No followers yet.</p>
          ) : (
            followers.map((r) => (
              <ReaderCard
                key={r.id}
                reader={r}
                onView={r.you_follow ? setReader : undefined}
                onFollow={r.you_follow ? undefined : follow}
              />
            ))
          )}
        </section>
      </main>

      <ReaderLibraryDialog
        open={!!reader}
        onOpenChange={(value) => { if (!value) setReader(null); }}
        reader={reader}
        myShelves={myShelves}
      />
    </div>
  );
}