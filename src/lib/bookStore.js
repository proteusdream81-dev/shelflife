import { base44 } from "@/api/base44Client";
import { prepareCoverFile } from "@/lib/coverUpload";
import { uploadCoverToFirebase, isFirebaseConfigured } from "@/lib/firebase";

// One place where a book is written so every screen that adds or updates a book
// does it the same way — shelf assignment, cover handling, and error shape.

const asRows = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
};

export function defaultShelfId(shelves = []) {
  const list = Array.isArray(shelves) ? shelves : [];
  const named = list.find((s) => /to[-\s]?read|tbr/i.test(String(s?.name || "")));
  return (named || list[0])?.id || "";
}

export function shelfNameFor(shelves = [], shelfId) {
  return (shelves || []).find((s) => s.id === shelfId)?.name || "";
}

function shelfIdFor(shelves, shelfId) {
  if (shelfId && (shelves || []).some((s) => s.id === shelfId)) return shelfId;
  return defaultShelfId(shelves);
}

export class BookSaveError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function createBook(record, shelves) {
  const payload = { status: "to_read", ...record, shelf_id: shelfIdFor(shelves, record?.shelf_id) };
  try {
    return await base44.entities.Book.create(payload);
  } catch (err) {
    throw new BookSaveError("Could not save that book. Try again.", "save");
  }
}

export async function createBooks(records = [], shelves, { checkDuplicates = true } = {}) {
  void checkDuplicates;
  const payloads = records.map((record) => ({
    status: "to_read",
    ...record,
    shelf_id: shelfIdFor(shelves, record?.shelf_id),
  }));

  const created = [];
  try {
    for (const payload of payloads) {
      created.push(await base44.entities.Book.create(payload));
    }
    return created;
  } catch {
    throw new BookSaveError("Could not save those books. Try again.", "save");
  }
}

export async function applyBookPatches(patches = []) {
  const results = [];
  for (const patch of patches) {
    if (!patch?.id) continue;
    const { id, ...fields } = patch;
    try {
      results.push(await base44.entities.Book.update(id, fields));
    } catch {
      // continue
    }
  }
  return results;
}

export async function updateBook(id, fields) {
  return base44.entities.Book.update(id, fields);
}

export async function uploadBookCover(file) {
  const prepared = await prepareCoverFile(file);
  if (isFirebaseConfigured()) {
    return uploadCoverToFirebase(prepared);
  }
  // Fall back to Base44 file upload when Firebase is not configured.
  const uploaded = await base44.integrations.Core.UploadFile({ file: prepared });
  return uploaded?.file_url || uploaded?.url || "";
}

export { asRows };
