import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader2, MessageCircle } from "lucide-react";
import AppNav from "@/components/tbr/AppNav";
import GroupChatPanel from "@/components/tbr/GroupChatPanel";

export default function BookGroupRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [group, setGroup] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    setGroup(null);
    setMissing(false);
    base44.entities.BookGroup.get(id)
      .then((row) => { if (active) setGroup(row); })
      .catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [id]);

  const title = group?.name || location.state?.name || "Book group";

  return (
    <div className="vp-page">
      <header className="vp-top">
        <div className="vp-topin max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="vp-brand">
              <div className="vp-mark"><MessageCircle strokeWidth={1.8} /></div>
              <div className="vp-brandtxt">
                <strong className="truncate">{title}</strong>
                <span>Group chat</span>
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

        {group && <GroupChatPanel group={group} onBack={() => navigate("/book-groups")} />}
      </main>
    </div>
  );
}