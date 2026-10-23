import React from "react";
import { BadgeCheck, CheckCircle2, MessageSquare, Sparkles } from "lucide-react";

const PERKS = [
  {
    icon: Sparkles,
    title: "Early access to new features",
    body: "CSV import, the release calendar and reading challenges reach testers before anyone else.",
  },
  {
    icon: BadgeCheck,
    title: "A Founding Tester badge",
    body: "It sits on your profile, so your shelves carry the mark of someone who was here first.",
  },
  {
    icon: MessageSquare,
    title: "A direct line to us",
    body: "Ask for features and report bugs in the same place. Tester requests go to the front of the list.",
  },
  {
    icon: CheckCircle2,
    title: "No posting obligation",
    body: "No reviews, no posts, no screenshots to send. Use the app, and tell us what breaks.",
  },
];

export default function BetaPerks() {
  return (
    <section>
      <h2 className="font-heading text-2xl text-foreground">What you get</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PERKS.map(({ icon: Icon, title, body }) => (
          <article key={title} className="vp-panel p-4">
            <div className="w-9 h-9 rounded-xl grid place-items-center bg-primary/15 text-primary">
              <Icon className="w-5 h-5" strokeWidth={1.9} />
            </div>
            <h3 className="mt-3 font-heading text-base leading-snug text-foreground">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}