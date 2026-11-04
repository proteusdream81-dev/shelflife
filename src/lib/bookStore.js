import { base44 } from "@/api/base44Client";

// Shared helpers for creating and updating books on the reader's shelves.

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

class BookSaveError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function createBook(record, shelves) {
  const payload = { status: "to_read", ...record, shelf_id: shelfIdFor(shelves, record?.shelf_id) };
  try {
    return await base44.entities.Book.create(payload);
  } catch {
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
      // continue with the rest
    }
  }
  return results;
}

export async function updateBook(id, fields) {
  return base44.entities.Book.update(id, fields);
}

export { BookSaveError, asRows };
