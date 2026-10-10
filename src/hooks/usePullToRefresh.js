import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 56;
const MAX = 88;
const RESISTANCE = 0.55;

/**
 * Pull-to-refresh for page-level (window) scrolling feeds.
 * Returns the current pull distance so a page can render an indicator.
 */
export default function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const distance = useRef(0);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);

  useEffect(() => { refresh.current = onRefresh; });

  const reset = useCallback(() => {
    startY.current = null;
    distance.current = 0;
    setPull(0);
  }, []);

  useEffect(() => {
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onStart = (event) => {
      if (busy.current || !atTop() || event.touches.length !== 1) return;
      startY.current = event.touches[0].clientY;
    };

    const onMove = (event) => {
      if (startY.current === null) return;
      const delta = event.touches[0].clientY - startY.current;
      if (delta <= 0 || !atTop()) {
        if (distance.current) reset();
        return;
      }
      const next = Math.min(delta * RESISTANCE, MAX);
      distance.current = next;
      setPull(next);
    };

    const onEnd = async () => {
      if (startY.current === null) return;
      const travelled = distance.current;
      startY.current = null;

      if (travelled < THRESHOLD) {
        reset();
        return;
      }

      busy.current = true;
      distance.current = THRESHOLD;
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await refresh.current();
      } finally {
        busy.current = false;
        setRefreshing(false);
        reset();
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [reset]);

  return { pull, refreshing };
}