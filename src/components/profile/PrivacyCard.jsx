import React from "react";
import { Switch } from "@/components/ui/switch";
import { Eye, Loader2, Lock } from "lucide-react";

export default function PrivacyCard({ hidden, saving, onToggle }) {
  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Privacy</h2>
        </div>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {hidden
              ? <Lock className="w-4 h-4 text-primary" strokeWidth={1.8} />
              : <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />}
            {hidden ? "Your profile is hidden" : "Your profile is visible"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {hidden
              ? "Other readers can't find you by email, and the shelves you share aren't listed in the reading circle. Lists you've already shared by link still work."
              : "Other readers can find you by email and browse the shelves you've chosen to share."}
          </p>
        </div>
        <Switch checked={hidden} onCheckedChange={onToggle} disabled={saving} aria-label="Hide my profile" />
      </div>
    </section>
  );
}