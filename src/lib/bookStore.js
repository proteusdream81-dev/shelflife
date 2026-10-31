import { base44 } from "@/api/base44Client";
import { prepareCoverFile } from "@/lib/coverUpload";

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

export async function createBooks(records = [], shelves) {
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

// The reader's own cover for a book is uploaded to storage anybody holding the link can
// open, because a cover has to show on a shelf the reader has shared with someone else.
// Images are resized and re-encoded to JPEG on the device first — raw camera HEIC/large
// JPEGs are what failed on select phones.
export async function uploadCover(file) {
  const prepared = await prepareCoverFile(file);
  if (!prepared) return "";
  const { file_url } = await base44.integrations.Core.UploadPublicFile({ file: prepared });
  return file_url || "";
}
