import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, UserPlus, X } from "lucide-react";

// Shown once, right after a reader shelves their very first book — the moment
// they have something worth sharing.
export default function InviteNudge({ onDone }) {
  const [copied, setCopied] = useState(false);
  const link = window.location.origin;
  const message = "I'm keeping my reading list on ShelfLife — come share shelves with me:";

  const invite = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "ShelfLife", text: message, url: link });
      } catch {
        // The reader closed the share sheet without picking anyone.
      }
      return;
    }
    navigator.clipboard?.writeText(`${message} ${link}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Reading is better with friends</h2>
        </div>
        <button type="button" className="vp-btn vp-icon" onClick={onDone} aria-label="Dismiss">
          <X />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Your first book is on the shelf. Invite a friend so you can share shelves and see what they're reading.
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button onClick={invite}>
          {copied ? <Check className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          {copied ? "Invite link copied" : "Invite a friend"}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/friends">Find readers</Link>
        </Button>
      </div>
    </section>
  );
}