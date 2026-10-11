import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, Check, Loader2 } from "lucide-react";
import ShareAudience from "@/components/tbr/ShareAudience";

const chosenFrom = (item) =>
  (item?.shared_with_ids || []).map((id, i) => ({ id, name: (item?.shared_with_names || [])[i] || "" }));

// The sharing controls for one shelf or one book. They are a panel rather than a dialog of
// their own, so a book's detail view can swap to them in place — dialogs stacked over
// dialogs hang in the installed Android build.
export default function SharePanel({ item, kind = "shelf", onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [audience, setAudience] = useState("circle");
  const [chosen, setChosen] = useState([]);
  const [readers, setReaders] = useState([]);
  const [loadingReaders, setLoadingReaders] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareTracked, setShareTracked] = useState(false);

  const what = kind === "book" ? "this book" : "this shelf";

  useEffect(() => {
    setEnabled(!!item?.share_enabled);
    setToken(item?.share_token || "");
    setAudience(item?.share_audience === "selected" ? "selected" : "circle");
    setChosen(chosenFrom(item));
    setCopied(false);
    setShareTracked(false);
  }, [item?.id]);

  // Everyone in my circle — the individual readers something can be shared with.
  useEffect(() => {
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
  }, []);

  // Readers this is already shared with stay listed, even if they have since left
  // my circle.
  const options = useMemo(() => {
    const ids = new Set(readers.map((r) => r.id));
    return [...readers, ...chosen.filter((c) => !ids.has(c.id))];
  }, [readers, chosen]);

  const shareUrl = token ? `${window.location.origin}/share/${token}` : "";

  // The shelves-shared KPI counts each shelf once, when it is first shared or its
  // link is first copied.
  const trackShare = () => {
    if (kind !== "shelf" || shareTracked) return;
    setShareTracked(true);
    base44.analytics.track({ eventName: "shelf_shared" });
  };

  const persist = async (patch) => {
    setSaving(true);
    try {
      if (kind === "book") await base44.entities.Book.update(item.id, patch);
      else await base44.entities.Shelf.update(item.id, patch);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (val) => {
    setEnabled(val);
    if (val) trackShare();
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
    // Something shared privately never keeps a public link.
    const t = next === "selected" ? "" : token || (enabled ? crypto.randomUUID() : "");
    setToken(t);
    await persist({ share_audience: next, share_token: t });
  };

  const toggleLink = async (val) => {
    if (val) trackShare();
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
    trackShare();
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 py-1">
        <div>
          <Label>Share {what}</Label>
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
          what={what}
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
                Anyone with the link can view {what} after signing in.
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
          The public link stays off while {what} is shared privately, so only the readers you picked can see it.
        </p>
      )}
    </>
  );
}