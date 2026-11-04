import React from "react";
import { RefreshCw } from "lucide-react";
import usePullToRefresh from "@/hooks/usePullToRefresh";

/**
 * Overlay pull-to-refresh indicator. Positioned fixed at the top so the
 * page layout never shifts when the user pulls.
 */
export default function PullToRefresh({ onRefresh }) {
  const { pull, refreshing } = usePullToRefresh(onRefresh);
  const visible = pull > 0 || refreshing;
  const height = refreshing ? 56 : pull;

  if (!visible) return null;

  return (
    <div
      className="ptr-bar"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: height > 8 ? "rgba(29, 12, 26, 0.55)" : "transparent",
      }}
      aria-hidden={!visible}
      aria-busy={refreshing || undefined}
    >
      <span
        className={`inline-flex ${refreshing ? "animate-spin" : ""}`}
        style={refreshing
          ? undefined
          : {
              transform: `rotate(${Math.round(pull * 2.4)}deg)`,
              opacity: Math.min(pull / 56, 1),
              transition: "opacity 0.1s linear",
            }}
      >
        <RefreshCw className="w-5 h-5 text-primary" strokeWidth={2.25} />
      </span>
    </div>
  );
}
