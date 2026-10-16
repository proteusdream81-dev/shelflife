import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";

// The typed wording is kept here rather than in the panel that shows results, so a
// keystroke never redraws the whole result list. The button runs the search itself, so a
// tap can never be swallowed by a form's own submission, while Enter and the keyboard's
// own search key still reach the same search through the form.
export default function BookSearchForm({ type, onTypeChange, loading, disabled, onSearch }) {
  const [text, setText] = useState("");

  const submit = (event) => {
    event.preventDefault();
    onSearch(text);
  };

  return (
    <form className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]" onSubmit={submit}>
      <div className="relative col-span-2 min-w-0 sm:col-span-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search books by title, author or ISBN"
          placeholder="Title, author or ISBN..."
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(event); }}
          disabled={disabled}
          enterKeyHint="search"
          className="h-11 min-w-0 pl-9"
        />
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
      <Button type="button" className="h-11" disabled={disabled} onClick={(event) => submit(event)}>
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching...</> : "Search"}
      </Button>
    </form>
  );
}