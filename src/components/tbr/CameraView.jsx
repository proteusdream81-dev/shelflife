import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import useCamera from "@/hooks/useCamera";
import { Camera, ScanLine } from "lucide-react";

export default function CameraView({ active, mode, onBarcode, onCapture }) {
  const { videoRef, error } = useCamera(active);
  const [barcodeSupported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const onBarcodeRef = useRef(onBarcode);

  useEffect(() => { onBarcodeRef.current = onBarcode; }, [onBarcode]);

  useEffect(() => {
    if (!active || mode !== "barcode" || !barcodeSupported) return undefined;
    let stopped = false;
    let detector = null;
    try {
      detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
    } catch {
      return undefined;
    }

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        if (!stopped && codes && codes.length && onBarcodeRef.current) {
          stopped = true;
          onBarcodeRef.current(codes[0].rawValue);
        }
      } catch {
        /* a single unreadable frame is fine */
      }
    };

    const id = setInterval(tick, 600);
    return () => { stopped = true; clearInterval(id); };
  }, [active, mode, barcodeSupported, videoRef]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob && onCapture) onCapture(blob); }, "image/jpeg", 0.85);
  };

  const frame = mode === "barcode" ? "w-4/5 h-24" : "w-3/5 h-4/5";

  return (
    <div className="space-y-3">
      <div className="relative aspect-square rounded-xl overflow-hidden bg-muted border border-border">
        <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`${frame} border-2 border-white/70 rounded-lg`} />
          </div>
        )}
        {error && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {error}
          </p>
        )}
      </div>

      {!error && mode === "cover" && (
        <Button type="button" className="w-full" onClick={capture}>
          <Camera className="w-4 h-4 mr-2" /> Capture cover
        </Button>
      )}

      {!error && mode === "barcode" && !barcodeSupported && (
        <p className="text-xs text-muted-foreground text-center">
          This browser can't read barcodes — use the cover photo or type the ISBN instead.
        </p>
      )}

      {!error && mode === "barcode" && barcodeSupported && (
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          <ScanLine className="w-3.5 h-3.5" /> Hold the book's barcode inside the frame
        </p>
      )}
    </div>
  );
}