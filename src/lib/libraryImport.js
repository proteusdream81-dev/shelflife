import { parseCsv, rowsToObjects } from "@/lib/csv";

// Placeholder restore marker - will be replaced with full content immediately
export function parseLibraryCsv() { return { source: "", books: [] }; }
export function shelfPlan() { return []; }
export function shelfMatcher() { return { remember: (s) => s, find: () => null }; }
export function toBookRecord() { return {}; }
export function existingIndex() { return new Map(); }
export function findExisting() { return null; }
export function metadataPatch() { return null; }
export function patchFilled() { return false; }
export function shelfNamesFor() { return []; }
export function shelfMembershipPatch() { return null; }
