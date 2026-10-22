import React from "react";
import { ShoppingBag } from "lucide-react";
import { STOREFRONT_OPTIONS, amazonStorefront, buyLinksDisclosureLong } from "@/lib/bookLinks";

// The stores a reader is most likely to want, in their own words; everything else Amazon runs
// stays available underneath them.
const PRIMARY = [
  { value: "amazon.com.au", label: "Australia — amazon.com.au" },
  { value: "amazon.com", label: "United States — amazon.com" },
  { value: "amazon.co.uk", label: "United Kingdom — amazon.co.uk" },
  { value: "amazon.ca", label: "Canada — amazon.ca" },
];

const OTHERS = STOREFRONT_OPTIONS.filter(
  (option) => option.value !== "auto" && !PRIMARY.some((primary) => primary.value === option.value)
);

// A native select, so the phone's own picker opens on every device and the installed app.
export default function StorefrontCard({ value = "", saving = false, disabled = false, error = "", onChange }) {
  const effective = amazonStorefront();

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Where to buy</h2>
        </div>
      </div>

      <label htmlFor="storefront-region" className="flex items-center gap-2 font-medium">
        <ShoppingBag className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />
        Storefront region
      </label>

      <select
        id="storefront-region"
        value={value}
        disabled={disabled || saving}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground disabled:opacity-60"
      >
        <option value="">Automatic (use my detected region)</option>
        {PRIMARY.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <optgroup label="Other Amazon storefronts">
          {OTHERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      </select>

      <p className="mt-2 text-sm text-muted-foreground">
        Buy links open {effective}, the Amazon store for this region.
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Amazon Australia links support ShelfLife through affiliate commissions.
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{buyLinksDisclosureLong}</p>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}