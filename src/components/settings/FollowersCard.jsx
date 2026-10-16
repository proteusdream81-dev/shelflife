import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import PersonRow from "@/components/settings/PersonRow";

// Who wants to follow you, who follows you, who you follow, and who you have blocked. Every
// answer here is decided by the server: a request can only be accepted or refused by the
// reader it was sent to, and a block ends the relationship both ways.
export default function FollowersCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await base44.functions.invoke("readingCircle", { action: "overview" });
      setData(res.data || {});
      setError("");
    } catch {
      setError("We couldn't load your readers just now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const run = async (key, action, extra = {}) => {
    setBusy(key);
    setError("");
    try {
      await base44.functions.invoke("readingCircle", { action, ...extra });
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't go through — please try again.");
    } finally {
      setBusy("");
    }
  };

  const requests = data?.requests || [];
  const followers = data?.followers || [];
  const following = data?.following || [];
  const requested = data?.requested || [];
  const blocked = data?.blocked || [];
  const none =
    !requests.length && !followers.length && !following.length && !requested.length && !blocked.length;

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Readers</h2>
          {requests.length > 0 && <span className="vp-badge">{requests.length}</span>}
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Following a reader sends them a request: they choose whether to accept it, and they can
        take a follower off again. Blocking ends it both ways and stops them reaching you.
      </p>

      {requests.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Waiting for your answer</h3>
          <div className="space-y-2">
            {requests.map((r) => (
              <PersonRow key={r.id} name={r.name} note="Would like to follow you">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `yes-${r.id}`}
                  onClick={() => run(`yes-${r.id}`, "respond", { user_id: r.id, accept: true })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={!!busy}
                  onClick={() => run(`no-${r.id}`, "respond", { user_id: r.id, accept: false })}
                >
                  Refuse
                </Button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {following.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">You follow</h3>
          <div className="space-y-2">
            {following.map((r) => (
              <PersonRow key={r.id} name={r.name} note={`${r.shared_shelves || 0} shared shelf${r.shared_shelves === 1 ? "" : "s"}`}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={!!busy}
                  onClick={() => run(`un-${r.id}`, "unfollow", { user_id: r.id })}
                >
                  Unfollow
                </Button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {requested.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Waiting on them</h3>
          <div className="space-y-2">
            {requested.map((r) => (
              <PersonRow key={r.id} name={r.name} note="Your request is waiting for their answer">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={!!busy}
                  onClick={() => run(`un-${r.id}`, "unfollow", { user_id: r.id })}
                >
                  Cancel
                </Button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {followers.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Following you</h3>
          <div className="space-y-2">
            {followers.map((r) => (
              <PersonRow key={r.id} name={r.name} note="Can see the shelves you share with your circle">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={!!busy}
                  onClick={() => run(`off-${r.id}`, "remove_follower", { user_id: r.id })}
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => run(`block-${r.id}`, "block", { user_id: r.id })}
                >
                  Block
                </Button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {blocked.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Blocked</h3>
          <div className="space-y-2">
            {blocked.map((r) => (
              <PersonRow key={r.id} name={r.name} note="Can't follow or invite you">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-primary"
                  disabled={!!busy}
                  onClick={() => run(`on-${r.id}`, "unblock", { user_id: r.id })}
                >
                  Unblock
                </Button>
              </PersonRow>
            ))}
          </div>
        </div>
      )}

      {none && !loading && (
        <p className="vp-empty">
          No readers yet. Find someone by name or username from the reading circle.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-destructive mt-3">{error}</p>}
    </section>
  );
}