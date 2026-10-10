import React from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Users, MapPin, User, MessageCircle, CalendarDays } from "lucide-react";

const ITEMS = [
  { to: "/", label: "My list", short: "My list", Icon: BookOpen },
  { to: "/friends", label: "Reading circle", short: "Circle", Icon: Users },
  { to: "/book-groups", label: "Book groups", short: "Groups", Icon: MessageCircle },
  { to: "/releases", label: "Release calendar", short: "Releases", Icon: CalendarDays },
  { to: "/near-me", label: "Near me", short: "Near me", Icon: MapPin },
  { to: "/profile", label: "My profile", short: "Profile", Icon: User },
];

export default function AppNav() {
  const { pathname } = useLocation();

  const headerNav = (
    <div className="vp-actions vp-navinline">
      {ITEMS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          title={label}
          aria-label={label}
          aria-current={pathname === to ? "page" : undefined}
          className={`vp-btn vp-icon ${pathname === to ? "vp-active" : ""}`}
        >
          <Icon strokeWidth={1.8} />
        </Link>
      ))}
    </div>
  );

  // Rendered into <body>: the sticky headers use backdrop-filter, which would
  // otherwise become the containing block for a fixed-position bar.
  const bottomNav = createPortal(
    <nav className="vp-navbar" aria-label="Main navigation">
      {ITEMS.map(({ to, label, short, Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          aria-current={pathname === to ? "page" : undefined}
          className={`vp-navitem ${pathname === to ? "vp-navitem-active" : ""}`}
        >
          <Icon strokeWidth={1.8} />
          <span>{short}</span>
        </Link>
      ))}
    </nav>,
    document.body
  );

  return (
    <>
      {headerNav}
      {bottomNav}
    </>
  );
}