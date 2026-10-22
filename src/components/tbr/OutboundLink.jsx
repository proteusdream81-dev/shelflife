import React from "react";

// A link that leaves the app. It is a plain anchor on purpose: the browser, and the installed
// app's own webview, both handle a real anchor tap natively — the phone hands the address to
// the shop's app or browser tab. Intercepting the tap in JavaScript is what made these links
// look broken, because a webview has no second window for window.open to put, and the
// substitute navigation took the reader out of ShelfLife altogether.
export default function OutboundLink({ href, children, className = "", ...rest }) {
  if (!href) return <span className={className}>{children}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}