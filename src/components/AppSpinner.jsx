import React from "react";

// Shared full-screen ShelfLife splash shown while the app boots and lazy pages load.
export default function AppSpinner() {
  return (
    <div className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-[#1d0c1a]">
      <img
        src="https://media.base44.com/images/public/6ac5feeacf2ab847112ee3ed/7ebd7e52d_shelflife-splash.jpg"
        alt="ShelfLife — Your shelf. Your rules."
        className="h-full w-full object-cover object-center"
        fetchPriority="high"
      />
    </div>
  );
}