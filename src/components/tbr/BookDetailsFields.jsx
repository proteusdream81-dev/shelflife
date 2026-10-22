import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// The book's own details, editable: what a catalogue got wrong — or never found — can be
// corrected here, and the correction travels with the book ever after. Native inputs on a
// native form, so it works the same in the installed app as on the web.
export default function BookDetailsFields({ value, onChange, idPrefix = "book-details" }) {
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value });

  const field = (label, name, props = {}) => (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={`${idPrefix}-${name}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${name}`}
        value={value?.[name] ?? ""}
        onChange={set(name)}
        className="h-11 sm:h-9"
        {...props}
      />
    </div>
  );

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Book details
      </legend>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("Title", "title", { required: true })}
        {field("Author", "author")}
        {field("ISBN", "isbn", { inputMode: "numeric", autoComplete: "off" })}
        {field("ASIN", "asin", { autoComplete: "off" })}
        {field("Series", "series_name")}
        {field("Series number", "series_position", { inputMode: "decimal", autoComplete: "off" })}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor={`${idPrefix}-description`}>Synopsis</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={value?.description ?? ""}
          onChange={set("description")}
          rows={4}
          placeholder="What the book is about"
        />
      </div>
    </fieldset>
  );
}