import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, Check, Loader2 } from "lucide-react";

export default function ShareDialog({ open, onOpenChange, shelf, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(!!shelf?.share_enabled);
    setToken(shelf?.share_token || "");
    setCopied(false);
  }, [shelf, open]);

  const shareUrl = token ? `${window.location.origin}/share/${token}` : "";

  const toggle = async (val) => {
    setEnabled(val);
    setSaving(true);
    try {
      let t = token;
      if (val && !t) {
        t = crypto.randomUUID();
        setToken(t);
      }
      await base44.entities.Shelf.update(shelf.id, { share_enabled: val, share_token: val ? t : "" });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{shelf?.name}"</DialogTitle>
          <DialogDescription>Anyone with the link can view this shelf's books — no login needed.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between py-2">
          <div>
            <Label>Shareable link</Label>
            <p className="text-xs text-muted-foreground">Turn on to generate a public link.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggle} disabled={saving} />
        </div>
        {saving && <div className="flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
        {enabled && token && (
          <div className="flex gap-2">
            <Input readOnly value={shareUrl} className="text-xs" />
            <Button size="icon" variant="outline" onClick={copy}>
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}