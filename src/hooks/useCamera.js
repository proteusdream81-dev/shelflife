import { useEffect, useRef, useState } from "react";

// Opens the device camera while `active` is true and releases it on cleanup.
export default function useCamera(active, facingMode = "environment") {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This device doesn't have a camera we can use.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.muted = true;
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setError("We couldn't start the camera. Check the camera permission, or use another option.");
      }
    };

    if (active) {
      setError("");
      start();
    } else {
      stop();
    }

    return () => { cancelled = true; stop(); };
  }, [active, facingMode]);

  return { videoRef, error };
}