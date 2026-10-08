import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import BookGroupCard from "@/components/tbr/BookGroupCard";
import CreateGroupDialog from "@/components/tbr/CreateGroupDialog";
import GroupChatPanel from "@/components/tbr/GroupChatPanel";

export default function BookGroups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const load = async () => {
      const rows = await base44.entities.BookGroup.list("-created_date", 50);
      setGroups(rows);
      setLoading(false);
    };
    load();
    const unsubscribe = base44.entities.BookGroup.subscribe(() => load());
    return unsubscribe;
  }, []);

  const handleCreated = (group) => {
    setGroups((prev) => [group, ...prev]);
    setActive(group);
  };

  return (
    <div className="vp-page">
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
        {active ? (
          <GroupChatPanel group={active} onBack={() => setActive(null)} />
        ) : (
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
                  <BookGroupCard key={group.id} group={group} onOpen={setActive} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <CreateGroupDialog open={creating} onOpenChange={setCreating} onCreated={handleCreated} />
    </div>
  );
}