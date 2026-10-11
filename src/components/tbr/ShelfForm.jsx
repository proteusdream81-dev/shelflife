import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

export default function ShelfForm({ open, onOpenChange, shelf, onSaved }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(shelf?.name || "");
    setDescription(shelf?.description || "");
    setIsPrivate(!!shelf?.is_private);
    setError("");
  }, [shelf, open]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const shelfName = name.trim();
    if (!shelfName) {
      setError("Give your shelf a name first.");
      return;
    }
    setError("");
    setSaving(true);
    // The dialog steps aside the moment the button is pressed, so the click always visibly
    // lands instead of leaving a form that looks like it ignored it.
    onOpenChange(false);
    try {
      if (shelf) {
        await base44.entities.Shelf.update(shelf.id, { name: shelfName, description, is_private: isPrivate });
      } else {
        await base44.entities.Shelf.create({ name: shelfName, description, is_private: isPrivate });
      }
      toast({ title: shelf ? "Shelf updated" : "Shelf created", description: shelfName });
      onSaved();
    } catch {
      toast({
        variant: "destructive",
        title: "That shelf didn't save",
        description: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{shelf ? "Edit shelf" : "New shelf"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center justify-between py-1">
            <div>
              <Label>Private shelf</Label>
              <p className="text-xs text-muted-foreground">Hidden until you choose to reveal it.</p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} {shelf ? "Save" : "Create shelf"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}