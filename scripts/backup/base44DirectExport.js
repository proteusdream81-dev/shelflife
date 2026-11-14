#!/usr/bin/env node
/**
 * Independent ShelfLife Base44 -> encrypted local bundle exporter.
 * No writes to Base44. R2 upload is deliberately fail-closed.
 */
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const APP_ID = process.env.BASE44_APP_ID || "6ac5feeacf2ab847112ee3ed";
export const ENTITIES = [
  "GroupInvite", "Book", "Follow", "Comment", "BookGroup", "ReaderSearch",
  "BookSearchCache", "WaitlistAttempt", "AccountDeletionRequest", "Report",
  "RateLimitHit", "Block", "PlacesCache", "Shelf", "Waitlist",
  "ClubSearchCache", "ReleaseReminder"
];
const PAGE_SIZE = Math.min(500, Math.max(25, Number(process.env.BASE44_PAGE_SIZE || 200)));
const OUT = process.env.BACKUP_OUTPUT_DIR || "./shelflife-backup";
const APP = encodeURIComponent(APP_ID);

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function baseUrl() {
  const raw = required("BASE44_PLATFORM_HOST");
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("BASE44_PLATFORM_HOST must use HTTPS");
  return u.toString().replace(/\/$/, "");
}
function authHeaders() {
  return {
    Authorization: `Bearer ${required("BASE44_WORKSPACE_API_KEY")}`,
    "X-Active-Workspace-Id": required("BASE44_ORG_ID"),
    Accept: "application/json"
  };
}
async function request(path, { binary = false } = {}) {
  const response = await fetch(baseUrl() + path, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Base44 ${response.status} for ${path}: ${detail}`);
  }
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
function unwrapArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "items", "records", "results", "users"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  throw new Error("Unrecognised Base44 list response; refusing to treat it as empty");
}
function countValue(payload) {
  const candidates = [payload, payload?.count, payload?.total, payload?.result,
    payload?.result?.count, payload?.data?.count, payload?.total_count];
  const n = candidates.find(x => Number.isSafeInteger(x) && x >= 0);
  if (n === undefined) throw new Error("Unrecognised Base44 count response");
  return n;
}
function cursorInfo(payload) {
  const p = payload?.result && !Array.isArray(payload.result) ? payload.result : payload;
  if (typeof p?.has_more !== "boolean") throw new Error("Cursor response missing boolean has_more");
  return { hasMore: p.has_more, cursor: p.next_cursor ?? p.nextCursor ?? null };
}
function recordKey(r) {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id) {
    throw new Error("Record without string id; refusing incomplete capture");
  }
  // Hash the complete canonical record, not only its timestamp: some source
  // paths may omit or fail to advance updated_date for a field-level change.
  return r.id + "\\u0000" + stableJson(r);
}
export function digestRecords(records) {
  const h = createHash("sha256");
  for (const value of records.map(recordKey).sort()) h.update(value).update("\n");
  return h.digest("hex");
}
function encryptionKey() {
  const b = Buffer.from(required("BACKUP_ENCRYPTION_KEY_BASE64"), "base64");
  if (b.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes");
  return b;
}
export function encryptBuffer(plain, key, iv = randomBytes(12)) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("SLBK1"), iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBuffer(envelope, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  if (envelope.length < 33 || envelope.subarray(0, 5).toString() !== "SLBK1") {
    throw new Error("Invalid backup envelope");
  }
  const iv = envelope.subarray(5, 17), tag = envelope.subarray(17, 33);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(envelope.subarray(33)), d.final()]);
}
import { createDecipheriv } from "node:crypto";

async function saveEncrypted(relative, bytes, key, manifestFiles) {
  const encrypted = encryptBuffer(Buffer.from(bytes), key);
  const path = join(OUT, relative + ".slbk");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, encrypted, { mode: 0o600, flag: "wx" });
  manifestFiles.push({
    path: relative + ".slbk",
    plaintext_bytes: Buffer.byteLength(bytes),
    encrypted_bytes: encrypted.length,
    plaintext_sha256: createHash("sha256").update(bytes).digest("hex"),
    encrypted_sha256: createHash("sha256").update(encrypted).digest("hex")
  });
}
async function listActive(entity, onPage) {
  const count = countValue(await request(`/api/apps/${APP}/entities/${encodeURIComponent(entity)}/count`));
  let cursor = null, page = 0, total = 0;
  const seenCursors = new Set(), ids = [], digestRows = [];
  while (true) {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) q.set("cursor", cursor);
    const payload = await request(`/api/apps/${APP}/entities/${encodeURIComponent(entity)}/v2/list?${q}`);
    const rows = unwrapArray(payload);
    for (const r of rows) { ids.push(r.id); digestRows.push(r); }
    total += rows.length;
    await onPage(rows, page++);
    const info = cursorInfo(payload);
    if (!info.hasMore) break;
    if (!info.cursor || seenCursors.has(info.cursor)) throw new Error(`Invalid/repeated cursor for ${entity}`);
    seenCursors.add(info.cursor); cursor = info.cursor;
  }
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate IDs in ${entity}`);
  if (total !== count) throw new Error(`RLS-visible count/list mismatch for ${entity}: count=${count}, listed=${total}`);
  return { count, total, digest: digestRecords(digestRows) };
}
async function listOffset(path, dataset, onPage, expectedCount = null) {
  let skip = 0, total = 0, page = 0;
  const ids = [], all = [];
  while (true) {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), skip: String(skip) });
    const payload = await request(path + "?" + q);
    const rows = unwrapArray(payload);
    for (const r of rows) { ids.push(r.id); all.push(r); }
    await onPage(rows, page++);
    total += rows.length; skip += rows.length;
    if (rows.length < PAGE_SIZE) break;
    if (page > 10000) throw new Error(`Pagination safety limit exceeded: ${dataset}`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate IDs in ${dataset}`);
  if (expectedCount !== null && total !== expectedCount) {
    throw new Error(`Count/list mismatch for ${dataset}: count=${expectedCount}, listed=${total}`);
  }
  return { count: expectedCount, total, digest: digestRecords(all) };
}
async function userCount() {
  return countValue(await request(`/api/apps/${APP}/entities/User/count`));
}
async function captureTrash(entity, files) {
  return listOffset(
    `/api/apps/${APP}/entities/${encodeURIComponent(entity)}/trash`,
    `trash/${entity}`,
    (rows, page) => saveEncrypted(`trash/${entity}/page-${String(page).padStart(5,"0")}.json`,
      Buffer.from(JSON.stringify(rows)), encryptionKey(), files)
  );
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => JSON.stringify(k)+":"+stableJson(value[k])).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function captureSchemas(key, files) {
  const payload = await request(`/api/apps/${APP}/entity-schemas`);
  if (!Array.isArray(payload?.schemas) || !Number.isSafeInteger(payload?.total) ||
      payload.total !== payload.schemas.length) {
    throw new Error("Unrecognised or incomplete entity schema response");
  }
  const schemas = payload.schemas.slice().sort((a,b)=>a.entity_name.localeCompare(b.entity_name));
  const bytes = Buffer.from(JSON.stringify({total:payload.total,schemas}));
  await saveEncrypted("schemas/entity-schemas.json", bytes, key, files);
  return { total:payload.total, digest:createHash("sha256").update(stableJson(schemas)).digest("hex") };
}
async function secondPassSchemas() {
  const payload = await request(`/api/apps/${APP}/entity-schemas`);
  if (!Array.isArray(payload?.schemas) || !Number.isSafeInteger(payload?.total) ||
      payload.total !== payload.schemas.length) throw new Error("Invalid second-pass schema response");
  const schemas = payload.schemas.slice().sort((a,b)=>a.entity_name.localeCompare(b.entity_name));
  return { total:payload.total, digest:createHash("sha256").update(stableJson(schemas)).digest("hex") };
}
async function captureActive(entity, files) {
  return listActive(entity, (rows, page) =>
    saveEncrypted(`active/${entity}/page-${String(page).padStart(5,"0")}.json`,
      Buffer.from(JSON.stringify(rows)), encryptionKey(), files));
}
async function secondPassActive(entity) {
  return listActive(entity, async () => {});
}
async function secondPassOffset(path, dataset, expectedCount = null) {
  return listOffset(path, dataset, async () => {}, expectedCount);
}
async function secondPassTrash(entity) {
  return listOffset(
    `/api/apps/${APP}/entities/${encodeURIComponent(entity)}/trash`,
    `trash/${entity}`,
    async () => {}
  );
}
async function uploadObjects(files, manifest) {
  if (process.env.ALLOW_R2_UPLOAD !== "true" || process.argv.includes("--upload") !== true) {
    throw new Error("Upload requires BOTH --upload and ALLOW_R2_UPLOAD=true");
  }
  if (manifest.status !== "COMPLETE") throw new Error("Refusing R2 upload: capture manifest is not COMPLETE");
  const account = required("CLOUDFLARE_ACCOUNT_ID");
  const bucket = required("R2_BUCKET");
  const token = required("CLOUDFLARE_R2_API_TOKEN");
  const uploadEntries = [...files, {
    path: "manifest.json",
    encrypted_bytes: (await readFile(join(OUT, "manifest.json"))).length,
    encrypted_sha256: createHash("sha256").update(await readFile(join(OUT, "manifest.json"))).digest("hex")
  }];
  for (const f of uploadEntries) {
    const body = await readFile(join(OUT, f.path));
    const key = `backups/${manifest.capture_id}/${f.path}`;
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" };
    const res = await fetch(url, { method: "PUT", headers, body });
    if (!res.ok) throw new Error(`R2 upload failed ${res.status} for ${key}: ${(await res.text()).slice(0,300)}`);
    const verify = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!verify.ok) throw new Error(`R2 read-back failed ${verify.status} for ${key}`);
    const returned = Buffer.from(await verify.arrayBuffer());
    const returnedHash = createHash("sha256").update(returned).digest("hex");
    if (returned.length !== f.encrypted_bytes || returnedHash !== f.encrypted_sha256) {
      throw new Error(`R2 read-back checksum/size mismatch for ${key}`);
    }
  }
}
async function main() {
  const key = encryptionKey();
  const host = baseUrl();
  void host;
  await mkdir(OUT, { recursive: true });
  if ((await readdir(OUT)).length) throw new Error(`Output directory is not empty: ${OUT}`);
  const captureId = new Date().toISOString().replace(/[:.]/g, "-");
  const files = [], inventories = {}, gaps = [
    "Entity read/count APIs enforce RLS; global completeness is not proven by credential-visible count/list parity.",
    "BookGroupRoom actor inventory is unavailable; room IDs for deleted/orphaned groups cannot be enumerated.",
    "BookGroupRoom retains at most 300 messages per room; older messages may already be irrecoverable.",
    "Removed app-user records are not available from the User list or User trash endpoint (User trash returns 404).",
    "Two-pass digest equality detects observed mutations but is not an atomic cross-entity snapshot or proof that no transient write occurred."
  ];
  inventories.__schemas = await captureSchemas(key, files);
  // Active custom entities and retained deleted-record trash are distinct datasets.
  for (const entity of ENTITIES) {
    inventories[entity] = { active: await captureActive(entity, files) };
    try {
      inventories[entity].trash = await captureTrash(entity, files);
    } catch (e) {
      if (!String(e.message).includes("404")) throw e;
      inventories[entity].trash = { status: "UNAVAILABLE_404", count: null, total: null };
      gaps.push(`Trash endpoint returned 404 for ${entity}; deleted records not captured.`);
    }
  }
  const uCount = await userCount();
  inventories.User = await listOffset(`/api/apps/${APP}/entities/User`, "User",
    (rows, page) => saveEncrypted(`active/User/page-${String(page).padStart(5,"0")}.json`,
      Buffer.from(JSON.stringify(rows)), key, files), uCount);

  if (process.argv.includes("--include-source-zip")) {
    const zip = await request(`/api/apps/${APP}/coding/export-to-zip`, { binary: true });
    await saveEncrypted("source/app-source.zip", zip, key, files);
  }
  // Second full pass: compare IDs + updated timestamps. Does not claim transaction isolation.
  let stable = true;
  for (const entity of ENTITIES) {
    const pass = await secondPassActive(entity);
    if (pass.count !== inventories[entity].active.count || pass.digest !== inventories[entity].active.digest) stable = false;
    const firstTrash = inventories[entity].trash;
    if (firstTrash?.status !== "UNAVAILABLE_404") {
      try {
        const trashPass = await secondPassTrash(entity);
        if (trashPass.total !== firstTrash.total || trashPass.digest !== firstTrash.digest) stable = false;
      } catch (e) {
        if (!String(e.message).includes("404")) throw e;
        stable = false;
      }
    }
  }
  const userPass = await secondPassOffset(`/api/apps/${APP}/entities/User`, "User", uCount);
  if (userPass.digest !== inventories.User.digest || userPass.total !== inventories.User.total) stable = false;
  const schemaPass = await secondPassSchemas();
  if (schemaPass.total !== inventories.__schemas.total || schemaPass.digest !== inventories.__schemas.digest) stable = false;
  if (!stable) gaps.push("Second-pass entity/user digest mismatch: source changed during capture.");
  const manifest = {
    format: "shelflife-independent-backup-v1", capture_id: captureId,
    created_at: new Date().toISOString(), app_id: APP_ID,
    source_host: new URL(baseUrl()).host, consistency: stable ? "TWO_PASS_STABLE_NON_ATOMIC" : "MUTATED_DURING_CAPTURE",
    inventories, files, gaps, status: "INCOMPLETE",
    completeness_note: "This runner never marks COMPLETE while RLS visibility, actor history, deleted users, and a supported atomic/quiescent consistency point remain unresolved.",
    encryption: { algorithm: "AES-256-GCM", key_source: "BACKUP_ENCRYPTION_KEY_BASE64 external secret; 32 raw bytes", envelope: "SLBK1 || 12-byte IV || 16-byte tag || ciphertext", key_embedded: false },
    restore: { tested: false, isolated_target: null },
    upload: { attempted: false, destination: process.env.R2_BUCKET || null }
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  await saveEncrypted("manifest.json", manifestBytes, key, files);
  // The sidecar inventories every encrypted object, including the encrypted manifest.
  const sidecarBytes = Buffer.from(JSON.stringify({ ...manifest, files }, null, 2));
  await writeFile(join(OUT, "manifest.json"), sidecarBytes, { mode: 0o600, flag: "wx" });
  if (process.argv.includes("--upload")) await uploadObjects(files, { ...manifest, files });
  console.log(JSON.stringify({ status: manifest.status, capture_id: captureId, datasets: Object.keys(inventories).length,
    encrypted_objects: files.length, gaps: gaps.length, output: OUT }, null, 2));
  if (manifest.status !== "COMPLETE") process.exitCode = 2;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
