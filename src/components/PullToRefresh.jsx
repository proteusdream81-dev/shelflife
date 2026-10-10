import React from "react";
import { RefreshCw } from "lucide-react";
import usePullToRefresh from "@/hooks/usePullToRefresh";

/**
 * Place as the first child inside a page wrapper: it renders the pull
 * indicator and handles the gesture, leaving the page markup untouched.
 */
export default function PullToRefresh({ onRefresh }) {
  const { pull, refreshing } = usePullToRefresh(onRefresh);

  return (
    <div className="ptr-bar" style={{ height: pull }} aria-hidden={pull === 0}>
      {(pull > 0 || refreshing) && (
        <RefreshCw
          className="w-5 h-5 text-primary"
          style={refreshing
            ? undefined
            : { transform: `rotate(${Math.round(pull * 2.4)}deg)`, opacity: Math.min(pull / 56, 1) }}
        />
      )}
    </div>
  );
}