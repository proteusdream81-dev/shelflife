import React, { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

// The invite a reader passes on: one plain link, which opens a page that explains ShelfLife and
// carries the Play link and the waitlist form for anyone who isn't ready to make an account
// yet. The address is shown as text as well as copied, so it can always be read out or copied
// by hand.
export const INVITE_URL = "https://shelflifetbr.com/invite.html";

export default function InviteCard() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Invite a friend</h2>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Send this link to a reader you want on your shelf. It opens a page that shows what
        ShelfLife does, and lets them install the app or join the launch list.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          readOnly
          value={INVITE_URL}
          aria-label="Your invite link"
          onFocus={(e) => e.target.select()}
          className="h-11 sm:h-10 flex-1 rounded-md border border-input bg-background/50 px-3 text-sm"
        />
        <button type="button" className="vp-btn vp-primary justify-center" onClick={copy}>
          <Copy />
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <a href={INVITE_URL} className="vp-btn vp-small" target="_blank" rel="noopener noreferrer">
          <ExternalLink /> See the invite page
        </a>
      </div>
    </section>
  );
}