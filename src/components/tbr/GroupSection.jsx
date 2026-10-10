import React from "react";
import BookGroupCard from "@/components/tbr/BookGroupCard";

export default function GroupSection({ title, badge, action, empty, groups, onOpen }) {
  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>{title}</h2>
          {badge > 0 && <span className="vp-badge">{badge}</span>}
        </div>
        {action && <div className="vp-shelfops">{action}</div>}
      </div>

      {groups.length === 0 ? (
        <p className="vp-empty">{empty}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <BookGroupCard key={group.id} group={group} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}