import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Download, Loader2 } from "lucide-react";
import ImportLibraryDialog from "@/components/tbr/ImportLibraryDialog";

// Bringing a library across from another reading app. It lives with the settings rather than on
// the shelf screen, because it is something a reader does once, not something they read from.
export default function ImportCard() {
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const loadShelves = async () => {
    try {
      setShelves(await base44.entities.Shelf.list("-created_date"));
    } catch {
      // The import itself creates any shelf it needs, so a list that won't load is not fatal.
      setShelves([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadShelves(); }, []);

  return (
    <section className="vp-shelf">
      <div className="vp-shelfhead">
        <div className="vp-titleline">
          <h2>Your library</h2>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-sm text-muted-foreground">
          Bring your list across from another reading app. Export it as a CSV file, then upload it
          here — your shelves, notes and ratings come across with it.
        </p>
        <button
          type="button"
          className="vp-btn vp-primary vp-small shrink-0"
          onClick={() => setOpen(true)}
          disabled={loading}
          aria-label="Import your library"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Download strokeWidth={1.8} />}
          Import
        </button>
      </div>

      <ImportLibraryDialog
        open={open}
        onOpenChange={setOpen}
        shelves={shelves}
        onImported={loadShelves}
      />
    </section>
  );
}