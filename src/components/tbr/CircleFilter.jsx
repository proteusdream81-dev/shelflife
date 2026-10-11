import React from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

// Narrows a list of readers to the one being looked for, wherever readers are picked or
// browsed by name. A reader's name is whatever the circle already shows for them.
export const filterByName = (readers, query) => {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return readers;
  return readers.filter((reader) => (reader.name || "").toLowerCase().includes(wanted));
};

export default function CircleFilter({ value, onChange, placeholder = "Search by name..." }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 pl-9"
      />
    </div>
  );
}