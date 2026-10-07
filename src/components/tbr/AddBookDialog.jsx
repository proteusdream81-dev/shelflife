import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import OnlineBookSearch from "@/components/tbr/OnlineBookSearch";
import ManualBookForm from "@/components/tbr/ManualBookForm";

export default function AddBookDialog({ open, onOpenChange, shelves, onAdded }) {
  const defaultShelfId = shelves[0]?.id || "";
  const close = () => { onOpenChange(false); onAdded(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a book</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="search">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="search">Search online</TabsTrigger>
            <TabsTrigger value="manual">Enter manually</TabsTrigger>
          </TabsList>
          <TabsContent value="search" className="mt-4">
            <OnlineBookSearch shelves={shelves} defaultShelfId={defaultShelfId} onAdded={close} />
          </TabsContent>
          <TabsContent value="manual" className="mt-4">
            <ManualBookForm shelves={shelves} defaultShelfId={defaultShelfId} onSaved={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}