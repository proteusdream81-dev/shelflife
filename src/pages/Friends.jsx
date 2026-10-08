import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Users } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
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
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="vp-brand">
              <div className="vp-mark">
                <Users strokeWidth={1.8} />
              </div>
              <div className="vp-brandtxt">
                <strong>Reading circle</strong>
                <span>Follow readers and browse the shelves they share</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <h2>Find a reader</h2>
            </div>
          </div>
          <FollowSearch followingIds={following.map((f) => f.id)} onFollow={follow} />
        </section>

        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <h2>Following</h2>
              <span className="vp-badge">{following.length}</span>
            </div>
          </div>
          {following.length === 0 ? (
            <p className="vp-empty">You're not following anyone yet.</p>
          ) : (
            <div className="space-y-2">
              {following.map((r) => (
                <ReaderCard key={r.id} reader={r} onView={setReader} onUnfollow={unfollow} />
              ))}
            </div>
          )}
        </section>

        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <h2>Followers</h2>
              <span className="vp-badge">{followers.length}</span>
            </div>
          </div>
          {followers.length === 0 ? (
            <p className="vp-empty">No followers yet.</p>
          ) : (
            <div className="space-y-2">
              {followers.map((r) => (
                <ReaderCard
                  key={r.id}
                  reader={r}
                  onView={r.you_follow ? setReader : undefined}
                  onFollow={r.you_follow ? undefined : follow}
                />
              ))}
            </div>
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