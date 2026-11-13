import React from "react";

// Shared dedication treatment at the end of every app screen. AppSpinner is rendered
// outside the route tree, so the splash never receives this footer.
const GREYHOUND_SKETCH = "https://media.base44.com/images/public/6acb4bff5b2cf5faa0b3fd45/7693b1702_greyhound-sketch-pink.png";

export default function DedicationFooter() {
  return (
    <footer className="vp-dedication">
      <span className="vp-dedication-label">For Jodi</span>
      <img
        className="vp-dedication-mark"
        src={GREYHOUND_SKETCH}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
    </footer>
  );
}