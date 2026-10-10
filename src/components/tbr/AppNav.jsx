import React, { useEffect, useState } from "react";
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

const STORE_KEY = "shelflife.tabPaths";

const readStoredPaths = () => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
};

const tabForPath = (pathname) =>
  ITEMS.find(({ to }) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`)
  );

export default function AppNav() {
  const { pathname } = useLocation();
  const [tabPaths, setTabPaths] = useState(readStoredPaths);
  const activeTab = tabForPath(pathname);

  // Remember the screen each tab was left on, so coming back to it resumes there.
  useEffect(() => {
    if (!activeTab || tabPaths[activeTab.to] === pathname) return;
    const next = { ...tabPaths, [activeTab.to]: pathname };
    setTabPaths(next);
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the memory then lasts only for this mount.
    }
  }, [pathname, activeTab, tabPaths]);

  // Tapping a different tab resumes its last screen; tapping the tab you are
  // already on returns to that tab's root.
  const hrefFor = (to) => (activeTab?.to === to ? to : tabPaths[to] || to);

  const headerNav = (
    <div className="vp-actions vp-navinline">
      {ITEMS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={hrefFor(to)}
          title={label}
          aria-label={label}
          aria-current={activeTab?.to === to ? "page" : undefined}
          className={`vp-btn vp-icon ${activeTab?.to === to ? "vp-active" : ""}`}
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
          to={hrefFor(to)}
          aria-label={label}
          aria-current={activeTab?.to === to ? "page" : undefined}
          className={`vp-navitem ${activeTab?.to === to ? "vp-navitem-active" : ""}`}
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