import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Upload } from "lucide-react";
import CoverTile from "@/components/tbr/CoverTile";
import { amazonCoverUrl } from "@/lib/bookCovers";
import { uploadCover } from "@/lib/bookStore";

// Every cover the catalogues hold for one book, plus the reader's own photo of the copy on
// their shelf. Picking one stores it on the book, so the shelf shows the printing they own.
export default function CoverPicker({ book, chosen, onPick, onCovers, busy }) {
  const [covers, setCovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    base44.functions
      .invoke("bookCovers", {
        isbn: book.isbn || "",
        title: book.title || "",
        author: book.author || "",
        google_books_id: book.google_books_id || "",
      })
      .then((res) => {
        // Amazon's own art is added here rather than on the server: its address is worked out
        // from the ISBN, so a book the catalogues hold no picture for still has one to offer.
        const list = [...(res.data.covers || [])];
        const amazon = amazonCoverUrl(book);
        if (amazon && !list.includes(amazon)) list.push(amazon);
        if (!active) return;
        setCovers(list);
        // What was found is handed back so the caller can keep it on the book, and a shelf
        // then has a cover to fall back on.
        if (list.length) onCovers?.(list);
      })
      .catch(() => { if (active) setError("We couldn't fetch other covers for this book just now."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [book.id]);

  const upload = async (file) => {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadCover(file);
      if (url) await onPick(url);
      else setError("That image couldn't be uploaded. Try a different photo or a smaller JPEG.");
    } catch {
      setError("That image couldn't be uploaded. Try a different photo, or use the camera gallery JPEG if your phone saves HEIC.");
    } finally {
      setUploading(false);
    }
  };

  // The cover in use is always one of the choices, even when it came from a photo the reader
  // uploaded rather than from a catalogue.
  const shown = chosen && !covers.includes(chosen) ? [chosen, ...covers] : covers;

  return (
    <div className="space-y-3">
      {loading && (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Looking for other covers...
        </div>
      )}

      {!loading && shown.length > 0 && (
        <div className="grid grid-cols-4 gap-2 max-h-72 overflow-y-auto">
          {shown.map((url) => (
            <CoverTile
              key={url}
              url={url}
              isChosen={url === chosen}
              busy={busy}
              onPick={onPick}
              onBroken={(dead) => setCovers((prev) => prev.filter((cover) => cover !== dead))}
            />
          ))}
        </div>
      )}

      {!loading && !shown.length && !error && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No other covers found for this book. You can use a photo instead.
        </p>
      )}

      <label className={`flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-sm cursor-pointer hover:bg-accent/40 transition-colors ${uploading ? "pointer-events-none opacity-70" : ""}`}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
        />
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? "Uploading..." : "Upload a photo of your copy"}
      </label>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
