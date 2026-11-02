import React from 'react';

export default function StorageUnavailable() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6 text-foreground">
      <div className="vp-panel max-w-md p-6 text-center">
        <h1 className="text-2xl">ShelfLife needs browser storage</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This browser or preview is blocking the storage needed to sign in. Open ShelfLife in your browser and allow site data, then try again.
        </p>
        <button type="button" className="vp-btn vp-primary mt-5" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </main>
  );
}