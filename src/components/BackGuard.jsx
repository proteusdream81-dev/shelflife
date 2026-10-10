import { useEffect } from "react";

// Anything a back press should close before it leaves the page. Radix overlays
// close on Escape, which is how a back press reaches them.
const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(",");

// The spare history step a back press lands on while an overlay is showing.
const OVERLAY_STEP = { shelflifeOverlay: true };

const openOverlay = () => document.querySelector(OVERLAY_SELECTOR);

const dismiss = (overlay) =>
  overlay.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    })
  );

/**
 * On a phone the back button leaves the app whenever the WebView has nowhere to
 * go back to — and an open dialog is not a history step of its own, so that is
 * what a back press used to do. The app therefore adds a step of its own while
 * an overlay is showing, and a back press closes the overlay and leaves the
 * page where it is.
 */
export default function BackGuard() {
  useEffect(() => {
    let armed = false;

    const arm = () => {
      if (armed) return;
      window.history.pushState(OVERLAY_STEP, "");
      armed = true;
    };

    const disarm = () => {
      if (!armed) return;
      armed = false;
      // Only drop the step this guard added — a page change may sit on top of it.
      if (window.history.state?.shelflifeOverlay) window.history.back();
    };

    // Keeps a step on the stack exactly while an overlay is open.
    const sync = () => (openOverlay() ? arm() : disarm());

    const handleBack = () => {
      if (!armed) return; // An ordinary page back — the router already has it.
      armed = false;
      const overlay = openOverlay();
      if (!overlay) return; // Dialog went on its own; the page back stands.
      dismiss(overlay);
      arm(); // Hold the page in place while the overlay closes.
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributeFilter: ["data-state"],
    });
    window.addEventListener("popstate", handleBack);
    sync();

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", handleBack);
    };
  }, []);

  return null;
}