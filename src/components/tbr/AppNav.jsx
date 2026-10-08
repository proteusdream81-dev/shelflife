import React from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Users, MapPin, User } from "lucide-react";

const ITEMS = [
  { to: "/", label: "My list", Icon: BookOpen },
  { to: "/friends", label: "Reading circle", Icon: Users },
  { to: "/near-me", label: "Near me", Icon: MapPin },
  { to: "/profile", label: "My profile", Icon: User },
];

export default function AppNav() {
  const { pathname } = useLocation();

  return (
    <div className="vp-actions">
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
}