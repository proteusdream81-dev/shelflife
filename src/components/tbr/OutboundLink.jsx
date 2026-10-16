import React from "react";

// A link that leaves the app. In a browser the new tab opens on its own, but an installed
// build's webview has no second window to open: there a plain target="_blank" link silently
// does nothing, which is how a buy link comes to look broken. So the tap is handled here and
// the address opens either way, in a new tab wherever the browser can give one.
export default function OutboundLink({ href, children, className = "", ...rest }) {
  const open = (event) => {
    if (!href) return;
    event.preventDefault();
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(href);
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={open}
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}