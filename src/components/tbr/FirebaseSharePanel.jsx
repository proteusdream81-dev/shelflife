import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Copy, Check, Loader2 } from "lucide-react";
import ShareAudience from "@/components/tbr/ShareAudience";
import { firebaseSharingApi } from "@/lib/firebaseSharingApi";
import { firebaseSocialGraphApi } from "@/lib/firebaseSocialGraphApi";

export default function FirebaseSharePanel({ item, kind = "shelf", onSaved, onShared }) {
  const [enabled, setEnabled] = useState(false);
  const [audience, setAudience] = useState("circle");
  const [chosen, setChosen] = useState([]);
  const [readers, setReaders] = useState([]);
  const [loadingReaders, setLoadingReaders] = useState(true);
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [version, setVersion] = useState(item?.version || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const what = kind === "book" ? "this book" : "this shelf";
  const shelfIsPrivate = kind === "shelf" && item?.is_private === true;
  const options = useMemo(() => {
    const ids = new Set(readers.map((reader) => reader.id));
    return [...readers, ...chosen.filter((reader) => !ids.has(reader.id))];
  }, [readers, chosen]);
  const shareUrl = token
    ? `${window.location.origin}/${kind === "book" ? "share" : "shelf"}/${token}`
    : "";

  useEffect(() => {
    setEnabled(item?.shareEnabled === true);
    setAudience(item?.shareAudience === "selected" ? "selected" : "circle");
    setChosen((item?.sharedWithUids || []).map((id) => ({ id, name: "Reader" })));
    setLinkEnabled(Boolean(item?.shareLinkId));
    setVersion(item?.version || "");
    setToken("");
    setCopied(false);
    setError("");
  }, [item?.id, item?.version]);

  useEffect(() => {
    let active = true;
    setLoadingReaders(true);
    firebaseSocialGraphApi.listCircle()
      .then((circle) => { if (active) setReaders(circle); })
      .catch((err) => { if (active) { setReaders([]); setError(err.message || "Reading Circle unavailable"); } })
      .finally(() => { if (active) setLoadingReaders(false); });
    return () => { active = false; };
  }, []);

  const persist = async (next = {}) => {
    if (!version) {
      setError("This record has no Firestore version. Reload it before changing sharing.");
      return null;
    }
    const nextEnabled = next.enabled ?? enabled;
    const nextAudience = next.audience ?? audience;
    const nextChosen = next.chosen ?? chosen;
    const nextLinkEnabled = next.linkEnabled ?? linkEnabled;
    setSaving(true);
    setError("");
    try {
      const result = await firebaseSharingApi.updateShareSettings(
        kind === "book" ? "books" : "shelves",
        item.id,
        {
          enabled: nextEnabled,
          audience: nextAudience,
          recipientUids: nextEnabled && nextAudience === "selected" ? nextChosen.map((reader) => reader.id) : [],
          linkEnabled: nextEnabled && nextAudience === "circle" && nextLinkEnabled,
        },
        version,
      );
      setEnabled(result.shareEnabled);
      setAudience(result.shareAudience);
      setChosen(nextChosen);
      setLinkEnabled(result.shareLinkEnabled);
      setToken(result.shareLinkToken || "");
      if (result.updateTime) setVersion(result.updateTime);
      if (result.shareLinkToken) onShared?.();
      onSaved?.(result);
      return result;
    } catch (err) {
      setError(err?.message || "Sharing settings could not be saved.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (value) => {
    await persist({
      enabled: value,
      chosen: value ? chosen : [],
      linkEnabled: value && audience === "circle" ? linkEnabled : false,
    });
  };
  const chooseAudience = async (next) => {
    await persist({ audience: next, linkEnabled: next === "circle" ? linkEnabled : false });
  };
  const toggleReader = async (reader) => {
    const next = chosen.some((entry) => entry.id === reader.id)
      ? chosen.filter((entry) => entry.id !== reader.id)
      : [...chosen, { id: reader.id, name: reader.name || "Reader" }];
    setChosen(next);
    if (enabled && audience === "selected") await persist({ chosen: next, linkEnabled: false });
  };
  const toggleLink = async (value) => {
    await persist({ linkEnabled: value });
  };
  const regenerateLink = async () => {
    await persist({ linkEnabled: true });
  };
  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("The link could not be copied. Select and copy it manually.");
    }
  };

  return (
    <>
      {shelfIsPrivate ? (
        <p className="text-xs text-muted-foreground">
          This shelf is marked private, so no other reader can see it. Make it public from “Edit shelf” to share it.
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 py-1">
          <div>
            <Label>Share {what}</Label>
            <p className="text-xs text-muted-foreground">Off keeps it private to you.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggleShare} disabled={saving} />
        </div>
      )}

      {enabled && !shelfIsPrivate && (
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

      {saving && <div className="flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {enabled && !shelfIsPrivate && audience === "circle" && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Shareable link</Label>
              <p className="text-xs text-muted-foreground">Anyone with the link can open {what}, no account needed.</p>
            </div>
            <Switch checked={linkEnabled} onCheckedChange={toggleLink} disabled={saving} />
          </div>
          {linkEnabled && !token && (
            <Button type="button" variant="outline" size="sm" onClick={regenerateLink} disabled={saving}>
              Generate a fresh link to copy
            </Button>
          )}
          {token && (
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} className="text-xs" />
              <Button type="button" size="icon" variant="outline" onClick={copy}>
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </div>
      )}

      {enabled && !shelfIsPrivate && audience === "selected" && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Only the readers you picked can see {what}. Public links stay off.
        </p>
      )}
    </>
  );
}
