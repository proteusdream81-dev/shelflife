import React from "react";

// Shared full-screen loader: shown while the app boots and while the code for a
// page is still downloading.
export default function AppSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin"></div>
    </div>
  );
}