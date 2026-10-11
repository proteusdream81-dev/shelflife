import { useEffect, useRef, useState } from "react";

// Opens the device camera while `active` is true and releases it on cleanup.
export default function useCamera(active, facingMode = "environment") {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const stop = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
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
          await video.play();
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) {
          stop();
          setReady(false);
          setError("We couldn't start the camera. Check the camera permission, or choose a photo instead.");
        }
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

  return { videoRef, error, ready };
}