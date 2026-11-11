import test from "node:test";
import assert from "node:assert/strict";
import { lookupCoverPhoto } from "./coverLookup.js";

const image = { type: "image/jpeg", size: 1200 };

test("uses on-device OCR and direct catalogues when they find a book", async () => {
  let legacyCalls = 0;
  const result = await lookupCoverPhoto(image, {
    recognize: async () => "The Great Gatsby F. Scott Fitzgerald",
    search: async (query, type) => {
      assert.equal(query, "The Great Gatsby F. Scott Fitzgerald");
      assert.equal(type, "all");
      return { books: [{ title: "The Great Gatsby" }] };
    },
    legacyIdentify: async () => { legacyCalls += 1; return { books: [] }; },
  });
  assert.equal(result.source, "direct-catalogue");
  assert.equal(result.books[0].title, "The Great Gatsby");
  assert.equal(legacyCalls, 0);
});

test("falls back to the hosted vision function when catalogues have no match", async () => {
  let legacyCalls = 0;
  const result = await lookupCoverPhoto(image, {
    recognize: async () => "Unusual title",
    search: async () => ({ books: [] }),
    legacyIdentify: async () => { legacyCalls += 1; return { books: [{ title: "Matched title" }], guess: { title: "Matched title" } }; },
  });
  assert.equal(result.source, "legacy-fallback");
  assert.equal(result.books[0].title, "Matched title");
  assert.equal(legacyCalls, 1);
});

test("falls back when local OCR cannot load or process the image", async () => {
  const result = await lookupCoverPhoto(image, {
    recognize: async () => { throw new Error("OCR unavailable"); },
    search: async () => { throw new Error("must not search without OCR text"); },
    legacyIdentify: async () => ({ books: [{ title: "Legacy match" }] }),
  });
  assert.equal(result.books[0].title, "Legacy match");
});

test("falls back when the direct catalogue lookup fails", async () => {
  const result = await lookupCoverPhoto(image, {
    recognize: async () => "Cover title",
    search: async () => { throw new Error("catalogue unavailable"); },
    legacyIdentify: async () => ({ books: [{ title: "Fallback match" }] }),
  });
  assert.equal(result.books[0].title, "Fallback match");
});

test("returns an empty result when OCR reads nothing and no legacy fallback is supplied", async () => {
  const result = await lookupCoverPhoto(image, { recognize: async () => "" });
  assert.deepEqual(result.books, []);
  assert.equal(result.source, "direct-catalogue");
});
