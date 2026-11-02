import React from "react";
import BrandMark from "@/components/BrandMark";

// Auth screens use the app icon (not a page glyph) so login/register match the site and PWA.
export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="vp-page flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <BrandMark />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="vp-panel p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
