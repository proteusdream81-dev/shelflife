import React, { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag } from "lucide-react";
import {
  STOREFRONT_OPTIONS,
  amazonStorefront,
  buyLinksDisclosureLong,
  savedStorefront,
  setStorefront,
} from "@/lib/bookLinks";

// Which Amazon store the buy links open. Left alone it follows the reader's own region; pinned
// here it stays where they put it, and every buy link in the app follows it from then on.
export default function StorefrontCard() {
  const [choice, setChoice] = useState(() => savedStorefront() || "auto");
  const storefront = amazonStorefront();

  const choose = (next) => {
    const host = next === "auto" ? "" : next;
    setChoice(host || "auto");
    setStorefront(host);
  };

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Where to buy</h2>
        </div>
      </div>

      <div className="space-y-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <ShoppingBag className="w-4 h-4 text-muted-foreground" strokeWidth={1.8} />
            Storefront region
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Buy links open {storefront}, the Amazon store for the region you choose.
            {choice === "auto" ? " This is your own region, as far as we can tell." : ""}
          </p>
        </div>

        <Select value={choice} onValueChange={choose}>
          <SelectTrigger aria-label="Storefront region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STOREFRONT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">{buyLinksDisclosureLong}</p>
    </section>
  );
}