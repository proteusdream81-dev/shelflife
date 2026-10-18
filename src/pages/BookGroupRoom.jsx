import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import GroupActionsCard from "@/components/tbr/GroupActionsCard";
import GroupChatPanel from "@/components/tbr/GroupChatPanel";
import GroupMembersCard from "@/components/tbr/GroupMembersCard";
import InviteReadersCard from "@/components/tbr/InviteReadersCard";

export default function BookGroupRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [group, setGroup] = useState(null);
  const [roster, setRoster] = useState({ members: [], pending: [] });
  const [me, setMe] = useState(null);
  const [missing, setMissing] = useState(false);
  const [kickId, setKickId] = useState("");

  useEffect(() => {
    let active = true;
    setGroup(null);
    setRoster({ members: [], pending: [] });
    setMissing(false);
    base44.auth.me().then((viewer) => { if (active) setMe(viewer); }).catch(() => {});
    base44.entities.BookGroup.get(id)
      .then((row) => { if (active) setGroup(row); })
      .catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [id]);

  const loadRoster = () =>
    base44.functions
      .invoke("bookGroups", { action: "members", group_id: id })
      .then(({ data }) => setRoster({ members: data.members || [], pending: data.pending || [] }))
      .catch(() => {});

  // Only a private group has a guest list; the readers on it are the ones who may join.
  useEffect(() => {
    if (!group?.is_private) return;
    loadRoster();
  }, [group?.is_private, id]);

  // Taking a reader out, whether from a message or from the member list, is one path:
  // the group record is written first, then the room drops them without waiting for
  // them to reconnect.
  const removeReader = async (userId) => {
    const { data } = await base44.functions.invoke("bookGroups", {
      action: "remove",
      group_id: id,
      user_id: userId,
    });
    setRoster({ members: data.members || [], pending: data.pending || [] });
    setKickId(userId);
  };

  const isOwner = !!group && group.created_by_id === me?.id;
  const title = group?.name || location.state?.name || "Book group";

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="vp-bar">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="vp-btn vp-icon"
              aria-label="Go back">
              <ArrowLeft strokeWidth={1.8} />
            </button>
            <div className="vp-brand">
              <div className="vp-mark"><MessageCircle strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong className="truncate">{title}</strong>
                <span>{group?.is_private ? "Private group chat" : "Group chat"}</span>
              </div>
            </div>
            <AppNav />
          </div>
        </div>
      </header>

      <main className="vp-main max-w-3xl mx-auto">
        {missing && (
          <section className="vp-empty">
            <p>This group is no longer available.</p>
            <Link to="/book-groups" className="vp-btn mt-3 inline-flex">
              Back to groups
            </Link>
          </section>
        )}

        {!missing && !group && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {group?.is_private && isOwner && (
          <InviteReadersCard
            groupId={group.id}
            memberIds={roster.members.map((member) => member.id)}
            pendingIds={roster.pending.map((invitee) => invitee.id)}
            onChanged={(data) => setRoster({ members: data.members || [], pending: data.pending || [] })}
          />
        )}

        {group && (
          <GroupChatPanel
            group={group}
            canModerate={isOwner}
            kickUserId={kickId}
            onRemoveReader={removeReader}
            onBack={() => navigate("/book-groups")}
          />
        )}

        {group?.is_private && (
          <GroupMembersCard
            members={roster.members}
            pending={roster.pending}
            canManage={isOwner}
            onRemove={removeReader}
          />
        )}

        {group && (
          <GroupActionsCard group={group} isOwner={isOwner} onDone={() => navigate("/book-groups")} />
        )}
      </main>
    </div>
  );
}