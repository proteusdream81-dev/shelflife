import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppNav from "@/components/tbr/AppNav";
import GroupSection from "@/components/tbr/GroupSection";
import CreateGroupDialog from "@/components/tbr/CreateGroupDialog";
import PullToRefresh from "@/components/PullToRefresh";

export default function BookGroups() {
  const navigate = useNavigate();
  const [mine, setMine] = useState([]);
  const [invited, setInvited] = useState([]);
  const [open, setOpen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const me = await base44.auth.me();
    // The group's own rules already hide a private group from everyone but its owner
    // and the readers invited to it, so this list is everything this reader may see.
    const { items } = await base44.entities.BookGroup.filter({}, { sort: "-created_date", limit: 50 });
    const rows = items || [];
    setMine(rows.filter((g) => g.created_by_id === me.id));
    setInvited(rows.filter((g) => g.created_by_id !== me.id && g.is_private));
    setOpen(rows.filter((g) => g.created_by_id !== me.id && !g.is_private));
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
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading groups...
          </div>
        )}

        {!loading && (
          <>
            <GroupSection
              title="Your groups"
              badge={mine.length}
              groups={mine}
              onOpen={openGroup}
              empty="No groups yet. Start one about a book you want to talk about."
              action={
                <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Start a group
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

            {open.length > 0 && (
              <GroupSection
                title="Public groups"
                badge={open.length}
                groups={open}
                onOpen={openGroup}
                empty=""
              />
            )}
          </>
        )}
      </main>

      <CreateGroupDialog open={creating} onOpenChange={setCreating} onCreated={openGroup} />
    </div>
  );
}