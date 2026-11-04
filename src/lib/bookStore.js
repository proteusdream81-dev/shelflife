import { base44 } from "@/api/base44Client";
import { prepareCoverFile } from "@/lib/coverUpload";
import { uploadCoverToFirebase, isFirebaseConfigured } from "@/lib/firebase";

// One place where a book is written, so every add and every edit behaves the same way.
// A book keeps the shelf the reader put it on, and a write that fails says so instead of
// leaving the old value in place looking as though the change had been saved.

const RETRY_DELAY_MS = 600;
const BULK_CHUNK = 200;

export class BookSaveError extends Error {
  constructor(message) {
    super(message);
    this.name = "BookSaveError";
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The shelf is checked against the shelves the reader actually has before anything is
// written, so a deleted or stale shelf is refused rather than saved as a dangling id.
export function shelfIdFor(shelves, shelfId) {
  const wanted = String(shelfId || "").trim();
  if (!wanted) throw new BookSaveError("Choose a shelf for this book first.");
  if (!(shelves || []).some((shelf) => shelf.id === wanted)) {
    throw new BookSaveError("That shelf is no longer there. Please pick another one.");
  }
  return wanted;
}

// Where a new book lands when the reader hasn't chosen: the "To Read" shelf if they have
// one, otherwise the first shelf that isn't private — never whichever private shelf
// happens to have been created most recently.
export function defaultShelfId(shelves = []) {
  const list = (shelves || []).filter((shelf) => shelf?.id);
  const toRead = list.find((shelf) => /^to\s*read$/i.test(String(shelf.name || "").trim()));
  return (toRead || list.find((shelf) => !shelf.is_private) || list[0])?.id || "";
}

export const shelfNameFor = (shelves, id) => (shelves || []).find((s) => s.id === id)?.name || "";

// The server hands the row back as it stored it, so a written shelf is checked against that
// answer: a save which quietly did not land is reported as a failure rather than leaving the
// reader looking at a shelf the book never reached.
async function writeOnce(id, patch) {
  const row = await base44.entities.Book.update(id, patch);
  if (patch.shelf_id && row?.shelf_id && row.shelf_id !== patch.shelf_id) {
    throw new Error("The shelf did not change");
  }
  return row;
}

// An update is worth one retry: a dropped connection or a momentary server error is the
// usual reason a save appears to have done nothing. A create is never retried — a second
// attempt could add the book twice when the first one did land.
async function updateWithRetry(id, patch) {
  try {
    return await writeOnce(id, patch);
  } catch {
    await wait(RETRY_DELAY_MS);
    try {
      return await writeOnce(id, patch);
    } catch {
      throw new BookSaveError("That change didn't save. Check your connection and try again.");
    }
  }
}

// Only what actually changed is written, so an untouched field is never sent back with a
// stale value and can't overwrite a change made somewhere else.
export async function updateBook(book, changes, shelves) {
  const patch = {};
  Object.entries(changes || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "shelf_id") {
      // A shelf is written only when the reader has actually moved the book. Sending an
      // unchanged shelf back with every other change is what let a save of a status, a note
      // or a rating put a book back on the shelf it had just been moved off.
      if (value !== book?.shelf_id) patch.shelf_id = shelfIdFor(shelves, value);
      return;
    }
    if (key === "format" && !value) return; // a format is replaced, never cleared
    if (value !== book?.[key]) patch[key] = value;
  });

  if (!Object.keys(patch).length) return { patch, saved: false };
  await updateWithRetry(book.id, patch);
  return { patch, saved: true };
}

export async function createBook(record, shelves) {
  const payload = { status: "to_read", ...record, shelf_id: shelfIdFor(shelves, record?.shelf_id) };
  try {
    return await base44.entities.Book.create(payload);
  } catch {
    throw new BookSaveError("We couldn't save this book. Please try again.");
  }
}

export async function createBooks(records = [], shelves, _opts) {
  const payloads = records.map((record) => ({
    status: "to_read",
    ...record,
    shelf_id: shelfIdFor(shelves, record?.shelf_id),
  }));

  const created = [];
  try {
    for (let i = 0; i < payloads.length; i += BULK_CHUNK) {
      const batch = await base44.entities.Book.bulkCreate(payloads.slice(i, i + BULK_CHUNK));
      created.push(...(batch || []));
    }
  } catch {
    throw new BookSaveError("We couldn't add those books. Please try again.");
  }
  return created;
}

// A bulk edit that fills in metadata found later (an import enrichment) — no retry, so a
// batch can never be applied twice.
export async function applyBookPatches(patches = []) {
  const rows = patches.filter((patch) => patch?.id);
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    await base44.entities.Book.bulkUpdate(rows.slice(i, i + BULK_CHUNK));
  }
  return rows.length;
}

// Read a prepared File/Blob as a data URL so the cover can live on the book record itself
// when no external storage is available. Shared shelves still show it because the URL is
// part of the book, not a separate file server.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

// Pull a useful message out of whatever the upload layer threw. Base44 integration-credit
// failures and Firebase rule / config errors both land here; the UI should never fall back
// to a generic "use a JPEG" line when the real problem is storage.
function uploadErrorMessage(err) {
  const raw = String(err?.message || err || "").toLowerCase();
  if (raw.includes("integration credit") || raw.includes("needs integration")) {
    return "Cover upload is temporarily unavailable (storage credits). Try again in a moment.";
  }
  if (raw.includes("storage/unauthorized") || raw.includes("permission")) {
    return "Cover storage is not allowing uploads right now.";
  }
  if (raw.includes("network") || raw.includes("failed to fetch")) {
    return "Couldn't reach cover storage. Check your connection and try again.";
  }
  return err?.message || "That image couldn't be uploaded. Try a different photo.";
}

// The reader's own cover for a book must show on shared shelves, so the result is always a
// URL (https or data:) that anyone holding the book record can open.
// Order: Firebase when configured → Base44 public upload → data URL embedded on the book.
// The data-URL path needs no credits and no extra config; it is the reliable beta fallback.
export async function uploadCover(file) {
  const prepared = await prepareCoverFile(file);
  if (!prepared) return "";

  // 1. Firebase Storage (preferred long-term, no Base44 credits)
  if (isFirebaseConfigured()) {
    try {
      return await uploadCoverToFirebase(prepared);
    } catch (err) {
      // Fall through to other paths rather than hard-failing if rules/config are wrong.
      console.warn("[uploadCover] Firebase failed, trying fallbacks", err);
    }
  }

  // 2. Base44 public upload (works while integration credits remain)
  try {
    const { file_url } = await base44.integrations.Core.UploadPublicFile({ file: prepared });
    if (file_url) return file_url;
  } catch (err) {
    const msg = String(err?.message || err || "").toLowerCase();
    // Credits / integration failures are expected in beta — continue to data URL.
    if (!msg.includes("integration") && !msg.includes("credit") && !msg.includes("quota")) {
      console.warn("[uploadCover] Base44 upload failed", err);
    }
  }

  // 3. Always-available fallback: store the prepared JPEG as a data URL on the book.
  try {
    const dataUrl = await fileToDataUrl(prepared);
    if (dataUrl && dataUrl.startsWith("data:image/")) return dataUrl;
  } catch (err) {
    throw new Error(uploadErrorMessage(err));
  }

  throw new Error("That image couldn't be uploaded. Try a different photo.");
}
