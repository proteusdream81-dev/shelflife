import React from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, ScanLine } from "lucide-react";

export default function CameraFrame({ videoRef, error, ready, mode, barcodeSupported, onCapture }) {
  const frame = mode === "barcode" ? "w-4/5 h-24" : "h-4/5 aspect-[2/3]";
  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[4/3] max-h-64 w-full overflow-hidden rounded-xl border border-border bg-muted">
        <video ref={videoRef} aria-label="Live camera preview" playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {!error && ready && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className={`${frame} rounded-lg border-2 border-foreground/70`} /></div>}
        {!error && !ready && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span>Starting camera...</span><span className="text-xs">Allow camera access to see the preview.</span></div>}
        {error && <p role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">{error}</p>}
      </div>
      {!error && mode === "cover" && <Button type="button" className="h-11 w-full" onClick={onCapture} disabled={!ready}><Camera className="h-4 w-4" /> Capture cover</Button>}
      {!error && mode === "barcode" && !barcodeSupported && <p className="text-center text-xs text-muted-foreground">This browser can't read barcodes. Use the cover photo or type the ISBN instead.</p>}
      {!error && mode === "barcode" && barcodeSupported && <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground"><ScanLine className="h-3.5 w-3.5" /> Hold the book's barcode inside the frame</p>}
    </div>
  );
}