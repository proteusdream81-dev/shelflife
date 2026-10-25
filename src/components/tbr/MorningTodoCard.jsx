import React, { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyRound, Briefcase, X } from "lucide-react";

// The two things to look at over Monday morning coffee. Ticking both clears the reminder for
// good, which is stored on the reader's account; the X only puts it away until next time.
const TASKS = [
  { id: "keys", label: "Review the signing keys in Play Console", Icon: KeyRound },
  { id: "jobs", label: "Review the freelance jobs", Icon: Briefcase },
];

export default function MorningTodoCard({ onDone, onClose }) {
  const [ticked, setTicked] = useState([]);

  const toggle = (id, on) => {
    const next = on ? [...ticked, id] : ticked.filter((item) => item !== id);
    setTicked(next);
    if (next.length === TASKS.length) onDone();
  };

  return (
    <section className="vp-panel p-4" aria-label="Morning reminders">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-primary">Monday morning</p>
          <h2 className="mt-1 text-xl text-foreground">Two things to review</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide this reminder"
          className="vp-btn vp-icon"
        >
          <X />
        </button>
      </div>

      <ul className="mt-3 space-y-1">
        {TASKS.map(({ id, label, Icon }) => (
          <li key={id}>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-foreground">
              <Checkbox
                checked={ticked.includes(id)}
                onCheckedChange={(on) => toggle(id, on === true)}
              />
              <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
              <span className={ticked.includes(id) ? "line-through text-muted-foreground" : ""}>
                {label}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}