import { base44 } from "@/api/base44Client";
import { prepareCoverFile } from "@/lib/coverUpload";
import { uploadCoverToFirebase, isFirebaseConfigured } from "@/lib/firebase";

const RETRY_DELAY_MS = 600;
const BULK_CHUNK = 200;

export class BookSaveError extends Error {
  constructor(message) {
    super(message);
    this.name = "BookSaveError";
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function shelfIdFor(shelves, shelfId) {
  const wanted = String(shelfId || "").trim();
  if (!wanted) throw new BookSaveError("Choose a shelf for this book first.");
  if (!(shelves || []).some((shelf) => shelf.id === wanted)) {
    throw new BookSaveError("That shelf is no longer there. Please pick another one.");
  }
  return wanted;
}

export function defaultShelfId(shelves = []) {
  const list = (shelves || []).filter((shelf) => shelf?.id);
  const toRead = list.find((shelf) => /^to\s*read$/i.test(String(shelf.name || "").trim()));
  return (toRead || list.find((shelf) => !shelf.is_private) || list[0])?.id || "";
}

export const shelfNameFor = (shelves, id) => (shelves || []).find((s) => s.id === id)?.name || "";

async function writeOnce(id, patch) {
  const row = await base44.entities.Book.update(id, patch);
  if (patch.shelf_id && row?.shelf_id && row.shelf_id !== patch.shelf_id) {
    throw new Error("The shelf did not change");
  }
  return row;
}

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

export async function updateBook(book, changes, shelves) {
  const patch = {};
  Object.entries(changes || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "shelf_id") {
      if (value !== book?.shelf_id) patch.shelf_id = shelfIdFor(shelves, value);
      return;
    }
    if (key === "format" && !value) return;
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

export async function applyBookPatches(patches = []) {
  const rows = patches.filter((patch) => patch?.id);
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    await base44.entities.Book.bulkUpdate(rows.slice(i, i + BULK_CHUNK));
  }
  return rows.length;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

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

export async function uploadCover(file) {
  const prepared = await prepareCoverFile(file);
  if (!prepared) return "";

  if (isFirebaseConfigured()) {
    try {
      return await uploadCoverToFirebase(prepared);
    } catch (err) {
      console.warn("[uploadCover] Firebase failed, trying fallbacks", err);
    }
  }

  try {
    const { file_url } = await base44.integrations.Core.UploadPublicFile({ file: prepared });
    if (file_url) return file_url;
  } catch (err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (!msg.includes("integration") && !msg.includes("credit") && !msg.includes("quota")) {
      console.warn("[uploadCover] Base44 upload failed", err);
    }
  }

  try {
    const dataUrl = await fileToDataUrl(prepared);
    if (dataUrl && dataUrl.startsWith("data:image/")) return dataUrl;
  } catch (err) {
    throw new Error(uploadErrorMessage(err));
  }

  throw new Error("That image couldn't be uploaded. Try a different photo.");
}
