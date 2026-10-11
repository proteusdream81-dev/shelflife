import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";

export default function BookSearchForm({ query, onQueryChange, type, onTypeChange, loading, disabled, onSearch }) {
  return (
    <form className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
      <div className="relative col-span-2 min-w-0 sm:col-span-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search books by title, author or ISBN" placeholder="Title, author or ISBN..." value={query} onChange={(event) => onQueryChange(event.target.value)} disabled={disabled} enterKeyHint="search" className="h-11 min-w-0 pl-9" />
      </div>
      <Select value={type} onValueChange={onTypeChange} disabled={disabled}>
        <SelectTrigger type="button" aria-label="Search by" className="h-11"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="title">Title</SelectItem>
          <SelectItem value="author">Author</SelectItem>
          <SelectItem value="isbn">ISBN</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" className="h-11" disabled={disabled || !query.trim()}>
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching...</> : "Search"}
      </Button>
    </form>
  );
}