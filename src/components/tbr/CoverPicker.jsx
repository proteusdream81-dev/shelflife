import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Upload } from "lucide-react";
import { uploadCover } from "@/lib/bookStore";

// Every cover the catalogues hold for one book, plus the reader's own photo of the copy on
// their shelf. Picking one stores it on the book, so the shelf shows the printing they own.
export default function CoverPicker({ book, chosen, onPick, busy }) {
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
      .then((res) => { if (active) setCovers(res.data.covers || []); })
      .catch(() => { if (active) setError("We couldn't fetch other covers for this book just now."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [book.id]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadCover(file);
      if (url) await onPick(url);
      else setError("That image couldn't be uploaded. Please try another one.");
    } catch {
      setError("That image couldn't be uploaded. Please try another one.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      {loading && (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Looking for other covers...
        </div>
      )}

      {!loading && covers.length > 0 && (
        <div className="grid grid-cols-4 gap-2 max-h-72 overflow-y-auto">
          {covers.map((url) => {
            const isChosen = url === chosen;
            return (
              <button
                key={url}
                type="button"
                onClick={() => !busy && onPick(url)}
                disabled={busy}
                aria-pressed={isChosen}
                className={`relative aspect-[2/3] overflow-hidden rounded-md border transition-colors ${
                  isChosen ? "border-primary" : "border-border hover:border-primary/60"
                }`}
              >
                <Image src={url} alt="" fittingType="fill" className="w-full h-full" loading="lazy" decoding="async" />
                {isChosen && (
                  <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && !covers.length && !error && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No other covers found for this book. You can use a photo instead.
        </p>
      )}

      <label className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
        />
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? "Uploading..." : "Upload a photo of your copy"}
      </label>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}