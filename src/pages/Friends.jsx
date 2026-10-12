import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Users, MessageCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import AppNav from "@/components/tbr/AppNav";
import FollowSearch from "@/components/tbr/FollowSearch";
import CircleFilter, { filterByName } from "@/components/tbr/CircleFilter";
import ReaderCard from "@/components/tbr/ReaderCard";

export default function Friends() {
  const navigate = useNavigate();
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followingQuery, setFollowingQuery] = useState("");
  const [followersQuery, setFollowersQuery] = useState("");

  const load = async () => {
    const res = await base44.functions.invoke("readingCircle", { action: "overview" });
    setFollowing(res.data.following || []);
    setFollowers(res.data.followers || []);
    setSuggested(res.data.suggested || []);
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const follow = async (userId) => {
    await base44.functions.invoke("readingCircle", { action: "follow", user_id: userId });
    await load();
  };

  const unfollow = async (userId) => {
    await base44.functions.invoke("readingCircle", { action: "unfollow", user_id: userId });
    await load();
  };

  const openReader = (reader) => navigate(`/friends/${reader.id}`, { state: { name: reader.name } });

  const shownFollowing = filterByName(following, followingQuery);
  const shownFollowers = filterByName(followers, followersQuery);

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
              <h2>Book clubs</h2>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Reading is better in company. Browse the clubs readers have started here, look up
            clubs running near you, or start one of your own.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link to="/book-groups" className="vp-btn vp-primary">
              <MessageCircle /> Find a club
            </Link>
            <Link to="/book-clubs" className="vp-btn">
              Book club host
            </Link>
          </div>
        </section>

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
              <h2>Readers sharing their shelves</h2>
            </div>
          </div>

          {suggested.length === 0 ? (
            <p className="vp-empty">
              No other readers are sharing shelves yet. Find one by email above, or invite a
              friend to join you here.
            </p>
          ) : (
            <div className="space-y-2">
              {suggested.map((r) => (
                <ReaderCard key={r.id} reader={r} onFollow={follow} followLabel="Follow" />
              ))}
            </div>
          )}
        </section>

        <section className="vp-shelf">
          <div className="vp-shelfhead">
            <div className="vp-titleline">
              <h2>Following</h2>
              <span className="vp-badge">{following.length}</span>
            </div>
          </div>
          {following.length > 3 && (
            <div className="mb-3">
              <CircleFilter value={followingQuery} onChange={setFollowingQuery} />
            </div>
          )}

          {following.length === 0 ? (
            <p className="vp-empty">You're not following anyone yet.</p>
          ) : shownFollowing.length === 0 ? (
            <p className="vp-empty">No reader matches that name.</p>
          ) : (
            <div className="space-y-2">
              {shownFollowing.map((r) => (
                <ReaderCard key={r.id} reader={r} onView={openReader} onUnfollow={unfollow} />
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
          {followers.length > 3 && (
            <div className="mb-3">
              <CircleFilter value={followersQuery} onChange={setFollowersQuery} />
            </div>
          )}

          {followers.length === 0 ? (
            <p className="vp-empty">No followers yet.</p>
          ) : shownFollowers.length === 0 ? (
            <p className="vp-empty">No reader matches that name.</p>
          ) : (
            <div className="space-y-2">
              {shownFollowers.map((r) => (
                <ReaderCard
                  key={r.id}
                  reader={r}
                  onView={r.you_follow ? openReader : undefined}
                  onFollow={r.you_follow ? undefined : follow}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}