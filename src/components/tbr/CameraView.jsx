import React, { useEffect, useRef, useState } from "react";
import useCamera from "@/hooks/useCamera";
import CameraFrame from "@/components/tbr/CameraFrame";

export default function CameraView({ active, mode, onBarcode, onCapture }) {
  const { videoRef, error, ready } = useCamera(active);
  const [barcodeSupported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const onBarcodeRef = useRef(onBarcode);

  useEffect(() => { onBarcodeRef.current = onBarcode; }, [onBarcode]);

  useEffect(() => {
    if (!active || !ready || mode !== "barcode" || !barcodeSupported) return undefined;
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
  }, [active, ready, mode, barcodeSupported, videoRef]);

  const capture = () => {
    const video = videoRef.current;
    if (!active || !ready || !video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob && onCapture) onCapture(blob); }, "image/jpeg", 0.85);
  };

  return <CameraFrame videoRef={videoRef} error={error} ready={ready} mode={mode} barcodeSupported={barcodeSupported} onCapture={capture} />;
}