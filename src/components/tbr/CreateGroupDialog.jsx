import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { CLUB_CATEGORIES } from "@/lib/clubCategories";

const NO_SUBJECT = "none";

export default function CreateGroupDialog({ open, onOpenChange, onCreated, defaults = null }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [location, setLocation] = useState("");
  const [meets, setMeets] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  // The form opens on a clean sheet, or on the club found out in the world that this one is
  // being modelled on: its subject and place carry over, and the reader names it.
  useEffect(() => {
    if (!open) return;
    setName("");
    setCategory(defaults?.category || "");
    setBookTitle("");
    setLocation(defaults?.location || "");
    setMeets("");
    setDescription(defaults?.description || "");
    setIsPrivate(false);
  }, [open, defaults]);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const group = await base44.entities.BookGroup.create({
        name: name.trim(),
        book_title: bookTitle.trim(),
        location: location.trim(),
        meets: meets.trim(),
        description: description.trim(),
        is_private: isPrivate,
        ...(category ? { category } : {}),
      });
      onOpenChange(false);
      onCreated(group);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Start a book club</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Club name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wednesday night readers" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What you read</Label>
            <Select value={category || NO_SUBJECT} onValueChange={(value) => setCategory(value === NO_SUBJECT ? "" : value)}>
              <SelectTrigger className="h-11 sm:h-9">
                <SelectValue placeholder="Any subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUBJECT}>Any subject</SelectItem>
                {CLUB_CATEGORIES.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Book you're reading</Label>
            <Input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Where you meet</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Online, or a town or city" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">When you meet</Label>
            <Input value={meets} onChange={(e) => setMeets(e.target.value)} placeholder="Second Tuesday each month, 7pm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">About this club</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-secondary/40 p-3">
            <div className="min-w-0">
              <Label className="text-xs">Private club</Label>
              <p className="text-xs text-muted-foreground mt-1">
                A public club can be found and joined by any reader. A private one is visible only
                to the readers you invite.
              </p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create club
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}