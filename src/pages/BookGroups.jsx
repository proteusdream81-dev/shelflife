import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppNav from "@/components/tbr/AppNav";
import GroupSection from "@/components/tbr/GroupSection";
import GroupInvitesCard from "@/components/tbr/GroupInvitesCard";
import CreateGroupDialog from "@/components/tbr/CreateGroupDialog";
import CategoryChips from "@/components/tbr/CategoryChips";
import ClubDiscovery from "@/components/tbr/ClubDiscovery";
import BookGroupCard from "@/components/tbr/BookGroupCard";
import PullToRefresh from "@/components/PullToRefresh";
import { nearestCategory } from "@/lib/clubCategories";

export default function BookGroups() {
  const navigate = useNavigate();
  const [mine, setMine] = useState([]);
  const [invited, setInvited] = useState([]);
  const [joinable, setJoinable] = useState([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [joiningId, setJoiningId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const me = await base44.auth.me();
    const [minePage, publicPage] = await Promise.all([
      // Everything this reader belongs to: the clubs they started, and the ones they joined.
      base44.entities.BookGroup.filter(
        { $or: [{ created_by_id: me.id }, { member_ids: me.id }] },
        { sort: "-created_date", limit: 50 }
      ),
      // Public clubs, narrowed by the subject the reader picked on the server rather than
      // from a page of clubs already on screen.
      base44.entities.BookGroup.filter(
        { is_private: { $ne: true }, ...(category ? { category } : {}) },
        { sort: "-created_date", limit: 50 }
      ),
    ]);

    const myGroups = minePage.items || [];
    const myIds = new Set(myGroups.map((group) => group.id));

    setMine(myGroups.filter((group) => group.created_by_id === me.id || !group.is_private));
    setInvited(myGroups.filter((group) => group.created_by_id !== me.id && group.is_private));
    setJoinable((publicPage.items || []).filter((group) => !myIds.has(group.id)));
  };

  useEffect(() => {
    let active = true;
    setBusy(true);
    load()
      .catch(() => {
        if (active) setError("We could not load your clubs just now. Please try again.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setBusy(false);
      });

    const unsubscribe = base44.entities.BookGroup.subscribe(() => {
      load().catch(() => {});
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [category]);

  const openGroup = (group) => navigate(`/book-groups/${group.id}`, { state: { name: group.name } });

  const startBlank = () => {
    setPrefill(null);
    setCreating(true);
  };

  // A club found out in the world becomes one started here: its subject and place carry
  // over, so the reader only has to give it a name.
  const startLike = (club) => {
    setPrefill({
      category: nearestCategory(club.category),
      location: club.where,
      description: `Inspired by “${club.name}” on ${club.source}.`,
    });
    setCreating(true);
  };

  const join = async (group) => {
    setJoiningId(group.id);
    setError("");
    try {
      await base44.functions.invoke("bookGroups", { action: "join", group_id: group.id });
      openGroup(group);
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't go through — please try again.");
    } finally {
      setJoiningId("");
    }
  };

  return (
    <div className="vp-page">
      <PullToRefresh onRefresh={load} />
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <div className="vp-brand">
              <div className="vp-mark"><MessageCircle strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong>Book clubs</strong>
                <span>Join a club, or start your own</span>
              </div>
            </div>
            <div className="vp-actions">
              <button type="button" className="vp-btn vp-primary" onClick={startBlank}>
                <Plus /> Start a club
              </button>
              <AppNav />
            </div>
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading clubs...
          </div>
        ) : (
          <>
            <GroupInvitesCard onAccepted={load} />

            <GroupSection
              title="Your clubs"
              badge={mine.length}
              groups={mine}
              onOpen={openGroup}
              empty="No clubs yet. Start one about a book you want to talk about."
              action={
                <Button size="sm" variant="outline" onClick={startBlank}>
                  <Plus className="w-4 h-4 mr-1" /> Start a club
                </Button>
              }
            />

            {invited.length > 0 && (
              <GroupSection
                title="Invited to"
                badge={invited.length}
                groups={invited}
                onOpen={openGroup}
                empty=""
              />
            )}

            <section className="vp-shelf">
              <div className="vp-shelfhead">
                <div className="vp-titleline">
                  <h2>Clubs you can join</h2>
                  {joinable.length > 0 && <span className="vp-badge">{joinable.length}</span>}
                </div>
              </div>

              <div className="mb-3">
                <CategoryChips value={category} onChange={setCategory} />
              </div>

              {busy ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Looking for clubs...
                </div>
              ) : joinable.length === 0 ? (
                <p className="vp-empty">
                  {category
                    ? `No club here reads ${category} yet. Start one, or search the clubs out in the world below.`
                    : "No clubs to join here yet. Start one, or search the clubs out in the world below."}
                </p>
              ) : (
                <div className="space-y-3">
                  {joinable.map((group) => (
                    <BookGroupCard
                      key={group.id}
                      group={group}
                      onOpen={openGroup}
                      onJoin={join}
                      joining={joiningId === group.id}
                    />
                  ))}
                </div>
              )}
            </section>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <ClubDiscovery onStartLike={startLike} />
          </>
        )}
      </main>

      <CreateGroupDialog
        open={creating}
        onOpenChange={(next) => {
          setCreating(next);
          if (!next) setPrefill(null);
        }}
        onCreated={openGroup}
        defaults={prefill}
      />
    </div>
  );
}