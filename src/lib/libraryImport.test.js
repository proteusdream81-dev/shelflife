import test from "node:test";
import assert from "node:assert/strict";
import { metadataPatch, patchFilled } from "./libraryImport.js";

test("uses the first edition cover when catalogue enrichment has no primary cover", () => {
  const patch = metadataPatch(
    { id: "book-1", cover_url: "", alt_covers: [] },
    { title: "A Book", cover_url: "", description: "A description" },
    ["https://covers.example/edition-1.jpg", "https://covers.example/edition-2.jpg"],
  );
  assert.equal(patch.cover_url, "https://covers.example/edition-1.jpg");
  assert.deepEqual(patch.alt_covers, ["https://covers.example/edition-2.jpg"]);
  assert.equal(patch.description, "A description");
  assert.equal(patch.enrichment_status, "enriched");
  assert.equal(patchFilled(patch), true);
});

test("adds edition alternatives without replacing an existing reader cover", () => {
  const patch = metadataPatch(
    { id: "book-2", cover_url: "https://reader.example/cover.jpg", alt_covers: [] },
    { title: "A Book", cover_url: "" },
    ["https://covers.example/edition-1.jpg", "https://covers.example/edition-2.jpg"],
  );
  assert.equal(Object.hasOwn(patch, "cover_url"), false);
  assert.deepEqual(patch.alt_covers, [
    "https://covers.example/edition-1.jpg",
    "https://covers.example/edition-2.jpg",
  ]);
});

test("preserves a reader's existing alternate covers and non-empty metadata", () => {
  const patch = metadataPatch(
    {
      id: "book-3", cover_url: "https://reader.example/cover.jpg",
      alt_covers: ["https://reader.example/alternate.jpg"], description: "Reader description",
    },
    { title: "A Book", cover_url: "https://catalogue.example/cover.jpg", description: "Catalogue description" },
    ["https://covers.example/edition-1.jpg"],
  );
  assert.equal(patch, null);
});

test("ignores non-HTTPS and malformed cover candidates", () => {
  const patch = metadataPatch(
    { id: "book-4", cover_url: "", alt_covers: [] },
    { title: "A Book", cover_url: "" },
    ["http://covers.example/insecure.jpg", "javascript:alert(1)", "not a URL"],
  );
  assert.equal(patch, null);
});