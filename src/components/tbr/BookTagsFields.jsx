import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Flame, Plus, X } from "lucide-react";
import { CONTENT_WARNINGS, MAX_WARNING_LENGTH, MAX_WARNING_TAGS } from "@/lib/contentWarnings";
import { MAX_SPICE, ROMANCE_SUBGENRES, spiceLabel } from "@/lib/spice";

// The reader's own tags for one book: how spicy it is, which kind of romance it is, and what
// it should carry a warning for. Everything here belongs to their copy of the book.
export default function BookTagsFields({ value, onChange, romance }) {
  const [custom, setCustom] = useState("");
  const spice = Number(value.spice_rating) || 0;
  const warnings = Array.isArray(value.content_warnings) ? value.content_warnings : [];
  const full = warnings.length >= MAX_WARNING_TAGS;

  const toggleWarning = (tag) => {
    onChange({
      content_warnings: warnings.includes(tag) ? warnings.filter((t) => t !== tag) : [...warnings, tag],
    });
  };

  // A tag of the reader's own, added through the form's own submit so it works without
  // anything cleverer than a form.
  const addCustom = (event) => {
    event.preventDefault();
    const tag = custom.trim().slice(0, MAX_WARNING_LENGTH);
    if (!tag || full) return;
    if (!warnings.includes(tag)) onChange({ content_warnings: [...warnings, tag] });
    setCustom("");
  };

  const customTags = warnings.filter(
    (tag) => !CONTENT_WARNINGS.some((warning) => warning.value.toLowerCase() === tag.toLowerCase())
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs">Spice</Label>
        <span className="text-[11px] text-muted-foreground">{spiceLabel(spice)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onChange({ spice_rating: 0 })}
          aria-pressed={spice === 0}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            spice === 0 ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
          }`}
        >
          None
        </button>
        {Array.from({ length: MAX_SPICE }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ spice_rating: spice === n ? 0 : n })}
            aria-pressed={n <= spice}
            aria-label={`Spice level ${n} of ${MAX_SPICE}`}
            className="rounded-full p-1.5"
          >
            <Flame className={`h-5 w-5 ${n <= spice ? "fill-primary text-primary" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">Show my spice rating to friends</p>
          <p className="text-[11px] text-muted-foreground">Off by default. Only your reading circle ever sees it.</p>
        </div>
        <Switch
          checked={Boolean(value.spice_shared)}
          onCheckedChange={(next) => onChange({ spice_shared: next })}
          aria-label="Show my spice rating to friends"
        />
      </div>

      {(romance || value.romance_subgenre || spice > 0) && (
        <div className="space-y-1.5">
          <Label className="text-xs">Kind of romance</Label>
          <Select
            value={value.romance_subgenre || "none"}
            onValueChange={(next) => onChange({ romance_subgenre: next === "none" ? "" : next })}
          >
            <SelectTrigger className="h-11 sm:h-9" aria-label="Kind of romance">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {ROMANCE_SUBGENRES.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Content warnings</Label>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_WARNINGS.map((warning) => {
            const on = warnings.some((tag) => tag.toLowerCase() === warning.value.toLowerCase());
            return (
              <button
                key={warning.value}
                type="button"
                onClick={() => toggleWarning(warning.value)}
                aria-pressed={on}
                disabled={!on && full}
                className={`rounded-full border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  on ? "border-destructive bg-destructive/15 text-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {warning.label}
              </button>
            );
          })}
        </div>

        {customTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleWarning(tag)}
                className="inline-flex items-center gap-1 rounded-full border border-destructive bg-destructive/15 px-2 py-1 text-[11px]"
              >
                {tag} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <form onSubmit={addCustom} className="flex items-center gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={MAX_WARNING_LENGTH}
            placeholder="Add your own tag"
            aria-label="Add your own content warning"
            className="h-9 text-xs"
          />
          <button type="submit" className="vp-btn vp-small shrink-0" disabled={!custom.trim() || full}>
            <Plus /> Add
          </button>
        </form>
      </div>
    </div>
  );
}