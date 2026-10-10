import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppNav from "@/components/tbr/AppNav";
import BookGroupCard from "@/components/tbr/BookGroupCard";
import CreateGroupDialog from "@/components/tbr/CreateGroupDialog";
import PullToRefresh from "@/components/PullToRefresh";

export default function BookGroups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setGroups(await base44.entities.BookGroup.list("-created_date", 50));
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
    const unsubscribe = base44.entities.BookGroup.subscribe(() => load());
    return unsubscribe;
  }, []);

  const openGroup = (group) => navigate(`/book-groups/${group.id}`, { state: { name: group.name } });

  return (
    <div className="vp-page">
      <PullToRefresh onRefresh={load} />
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="vp-brand">
              <div className="vp-mark"><MessageCircle strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong>Book groups</strong>
                <span>Chat with readers about a book</span>
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
              <h2>Reading groups</h2>
              {groups.length > 0 && <span className="vp-badge">{groups.length}</span>}
            </div>
            <div className="vp-shelfops">
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus className="w-4 h-4 mr-1" /> Start a group
              </Button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading groups...
            </div>
          )}

          {!loading && groups.length === 0 && (
            <p className="vp-empty">No groups yet. Start one about a book you want to talk about.</p>
          )}

          {!loading && groups.length > 0 && (
            <div className="space-y-3">
              {groups.map((group) => (
                <BookGroupCard key={group.id} group={group} onOpen={openGroup} />
              ))}
            </div>
          )}
        </section>
      </main>

      <CreateGroupDialog open={creating} onOpenChange={setCreating} onCreated={openGroup} />
    </div>
  );
}