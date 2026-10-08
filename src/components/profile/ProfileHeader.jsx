import React from "react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function ProfileHeader({ name, email, onSignOut }) {
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <section className="vp-shelf">
      <div className="flex items-center gap-4">
        <div className="vp-mark shrink-0">
          <span className="font-heading text-lg">{initial}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-xl leading-tight truncate">{name || "Reader"}</h2>
          <p className="text-sm text-muted-foreground truncate">{email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut} className="shrink-0">
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </section>
  );
}