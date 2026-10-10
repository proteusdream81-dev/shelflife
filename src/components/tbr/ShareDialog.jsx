import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, Check, Loader2 } from "lucide-react";
import ShareAudience from "@/components/tbr/ShareAudience";

const chosenFrom = (shelf) =>
  (shelf?.shared_with_ids || []).map((id, i) => ({ id, name: (shelf?.shared_with_names || [])[i] || "" }));

export default function ShareDialog({ open, onOpenChange, shelf, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [audience, setAudience] = useState("circle");
  const [chosen, setChosen] = useState([]);
  const [readers, setReaders] = useState([]);
  const [loadingReaders, setLoadingReaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(!!shelf?.share_enabled);
    setToken(shelf?.share_token || "");
    setAudience(shelf?.share_audience === "selected" ? "selected" : "circle");
    setChosen(chosenFrom(shelf));
    setCopied(false);
  }, [shelf, open]);

  // Everyone in my circle — the individual readers a shelf can be shared with.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingReaders(true);
    base44.functions
      .invoke("readingCircle", { action: "overview" })
      .then((res) => {
        if (!active) return;
        const all = [...(res.data.following || []), ...(res.data.followers || [])];
        const seen = new Set();
        setReaders(
          all
            .filter((r) => r?.id && !seen.has(r.id) && seen.add(r.id))
            .map((r) => ({ id: r.id, name: r.name || "Reader" }))
        );
      })
      .catch(() => active && setReaders([]))
      .finally(() => active && setLoadingReaders(false));
    return () => { active = false; };
  }, [open]);

  // Readers this shelf is already shared with stay listed, even if they have
  // since left my circle.
  const options = useMemo(() => {
    const ids = new Set(readers.map((r) => r.id));
    return [...readers, ...chosen.filter((c) => !ids.has(c.id))];
  }, [readers, chosen]);

  const shareUrl = token ? `${window.location.origin}/share/${token}` : "";

  const persist = async (patch) => {
    setSaving(true);
    try {
      await base44.entities.Shelf.update(shelf.id, patch);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (val) => {
    setEnabled(val);
    const t = !val || audience === "selected" ? "" : token || crypto.randomUUID();
    setToken(t);
    await persist({
      share_enabled: val,
      share_token: t,
      share_audience: audience,
      shared_with_ids: chosen.map((c) => c.id),
      shared_with_names: chosen.map((c) => c.name),
    });
  };

  const chooseAudience = async (next) => {
    setAudience(next);
    // A privately shared shelf never keeps a public link.
    const t = next === "selected" ? "" : token || (enabled ? crypto.randomUUID() : "");
    setToken(t);
    await persist({ share_audience: next, share_token: t });
  };

  const toggleLink = async (val) => {
    const t = val ? token || crypto.randomUUID() : "";
    setToken(t);
    await persist({ share_token: t });
  };

  const toggleReader = async (reader) => {
    const next = chosen.some((c) => c.id === reader.id)
      ? chosen.filter((c) => c.id !== reader.id)
      : [...chosen, { id: reader.id, name: reader.name || "" }];
    setChosen(next);
    await persist({
      shared_with_ids: next.map((c) => c.id),
      shared_with_names: next.map((c) => c.name),
    });
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
          <DialogDescription>Decide who can browse this shelf from their reading circle.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 py-1">
          <div>
            <Label>Share this shelf</Label>
            <p className="text-xs text-muted-foreground">Off keeps it private to you.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggleShare} disabled={saving} />
        </div>

        {enabled && (
          <ShareAudience
            audience={audience}
            chosen={chosen}
            readers={options}
            loading={loadingReaders}
            onAudience={chooseAudience}
            onToggle={toggleReader}
          />
        )}

        {saving && (
          <div className="flex justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {enabled && audience === "circle" && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Shareable link</Label>
                <p className="text-xs text-muted-foreground">
                  Anyone with the link can view this shelf's books after signing in.
                </p>
              </div>
              <Switch checked={!!token} onCheckedChange={toggleLink} disabled={saving} />
            </div>
            {token && (
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} className="text-xs" />
                <Button size="icon" variant="outline" onClick={copy}>
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </div>
        )}

        {enabled && audience === "selected" && (
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            The public link stays off while a shelf is shared privately, so only the readers you picked can see it.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}