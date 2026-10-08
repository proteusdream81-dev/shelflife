import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

export default function CreateGroupDialog({ open, onOpenChange, onCreated }) {
  const [name, setName] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const group = await base44.entities.BookGroup.create({
        name: name.trim(),
        book_title: bookTitle.trim(),
        description: description.trim(),
      });
      setName("");
      setBookTitle("");
      setDescription("");
      onOpenChange(false);
      onCreated(group);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Start a book group</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Group name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wednesday night readers" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Book you're reading</Label>
            <Input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">About this group</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}