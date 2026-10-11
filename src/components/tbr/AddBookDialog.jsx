import React from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import OnlineBookSearch from "@/components/tbr/OnlineBookSearch";
import ManualBookForm from "@/components/tbr/ManualBookForm";
import ScanBook from "@/components/tbr/ScanBook";

export default function AddBookDialog({ open, onOpenChange, shelves, onAdded, books = [] }) {
  const defaultShelfId = shelves[0]?.id || "";
  const close = () => { onOpenChange(false); onAdded(); };

  // One event for every book that actually reaches a shelf.
  const trackAdded = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      base44.analytics.track({ eventName: "book_added" });
    }
  };

  const handleAdded = (count = 1) => {
    trackAdded(count);
    onAdded();
  };

  const handleManualSaved = () => {
    trackAdded();
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a book</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="search">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="scan">Scan</TabsTrigger>
          </TabsList>
          <TabsContent value="search" className="mt-4">
            <OnlineBookSearch shelves={shelves} defaultShelfId={defaultShelfId} onAdded={handleAdded} books={books} />
          </TabsContent>
          <TabsContent value="manual" className="mt-4">
            <ManualBookForm shelves={shelves} defaultShelfId={defaultShelfId} onSaved={handleManualSaved} />
          </TabsContent>
          <TabsContent value="scan" className="mt-4">
            <ScanBook shelves={shelves} defaultShelfId={defaultShelfId} onAdded={handleAdded} books={books} />
          </TabsContent>
        </Tabs>
        <div className="flex justify-end">
          <Button variant="outline" onClick={close}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}