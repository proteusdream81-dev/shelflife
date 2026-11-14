const BASE44_BOOTSTRAP_EXEMPT_PREVIEW_ROUTES = new Set([
  "/firebase-auth-preview",
  "/firebase-groups-preview",
  "/firebase-library-preview",
]);

/** These isolated previews do not need Base44. The identity-link preview does. */
export function shouldSkipBase44Bootstrap(pathname) {
  return BASE44_BOOTSTRAP_EXEMPT_PREVIEW_ROUTES.has(pathname);
}
