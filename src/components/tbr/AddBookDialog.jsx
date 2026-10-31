import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import OnlineBookSearch from "@/components/tbr/OnlineBookSearch";
import ManualBookForm from "@/components/tbr/ManualBookForm";
import ScanBook from "@/components/tbr/ScanBook";
import ShareDialog from "@/components/tbr/ShareDialog";
import ReviewPromptBanner from "@/components/tbr/ReviewPromptBanner";
import { shouldPromptForReview } from "@/lib/reviewPrompt";
import { defaultShelfId } from "@/lib/bookStore";

export default function AddBookDialog({ open, onOpenChange, shelves, onAdded, books = [] }) {
  // A new book lands on the "To Read" shelf, never on whichever private shelf happens to have
  // been created most recently — a book that went there would leave the list unannounced.
  const landingShelfId = defaultShelfId(shelves);
  const [wasEmpty, setWasEmpty] = useState(false);
  const [shareShelfId, setShareShelfId] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const close = () => { onOpenChange(false); onAdded(); };

  // Whether this is the reader's very first book has to be settled before the add,
  // because the add itself changes the answer.
  useEffect(() => {
    if (!open) return;
    setShareShelfId("");
    setShowReview(false);
    base44.entities.Book.count({})
      .then((total) => setWasEmpty(total === 0))
      .catch(() => setWasEmpty(false));
  }, [open]);

  // One event for every book that actually reaches a shelf.
  const trackAdded = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      base44.analytics.track({ eventName: "book_added" });
    }
  };

  // Only ever fires once, when the library reaches five books.
  const checkReviewPrompt = async () => {
    if (await shouldPromptForReview()) setShowReview(true);
  };

  const handleAdded = (count = 1, shelfId) => {
    trackAdded(count);
    // The first book is the moment there is something worth sharing.
    if (wasEmpty && !shareShelfId) setShareShelfId(shelfId || landingShelfId);
    onAdded();
    checkReviewPrompt();
  };

  // The add sheet has done its job, so it steps aside rather than stacking two
  // modals on top of each other in the mobile app.
  const openShare = () => {
    setShareOpen(true);
    close();
  };

  const handleManualSaved = async () => {
    trackAdded();
    // The fifth book earns the review ask, so the sheet stays up long enough to
    // show it instead of closing straight away.
    if (await shouldPromptForReview()) {
      setShowReview(true);
      return;
    }
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,48rem)] max-w-lg flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add a book</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="search" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid h-11 shrink-0 grid-cols-3 w-full">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="scan">Scan</TabsTrigger>
          </TabsList>
          <TabsContent value="search" className="mt-4 min-h-0 flex-1 overflow-hidden">
            <OnlineBookSearch shelves={shelves} onAdded={handleAdded} books={books} />
          </TabsContent>
          <TabsContent value="manual" className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <ManualBookForm shelves={shelves} books={books} defaultShelfId={landingShelfId} onSaved={handleManualSaved} />
          </TabsContent>
          <TabsContent value="scan" className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <ScanBook shelves={shelves} defaultShelfId={landingShelfId} onAdded={handleAdded} books={books} />
          </TabsContent>
        </Tabs>

        {shareShelfId && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-3 mt-4">
            <p className="text-sm">Enjoying ShelfLife? Share your shelf with a friend</p>
            <Button size="sm" onClick={openShare}>
              <Share2 className="w-4 h-4" /> Share shelf
            </Button>
          </div>
        )}

        {showReview && <ReviewPromptBanner onDismiss={() => setShowReview(false)} />}

        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={close}>Done</Button>
        </div>
      </DialogContent>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        shelf={shelves.find((s) => s.id === shareShelfId) || shelves[0]}
        onSaved={onAdded}
      />
    </Dialog>
  );
}
