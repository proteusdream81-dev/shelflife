import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecognizedText, validateCoverImage } from "./coverOcr.js";

test("accepts supported browser image types within the size limit", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateCoverImage({ type, size: 1024 }), true);
  }
});

test("rejects missing and empty images", () => {
  assert.throws(() => validateCoverImage(null), /Choose a photo/);
  assert.throws(() => validateCoverImage({ type: "image/jpeg", size: 0 }), /empty/);
});

test("rejects unsupported image formats", () => {
  assert.throws(
    () => validateCoverImage({ type: "image/svg+xml", size: 100 }),
    /JPEG, PNG or WebP/,
  );
});

test("rejects images larger than 12 MB before OCR starts", () => {
  assert.throws(
    () => validateCoverImage({ type: "image/jpeg", size: 12 * 1024 * 1024 + 1 }),
    /larger than 12 MB/,
  );
});

test("rejects invalid image sizes", () => {
  assert.throws(() => validateCoverImage({ type: "image/jpeg", size: NaN }), /empty/);
});


test("normalizes OCR line breaks and repeated whitespace", () => {
  assert.equal(
    normalizeRecognizedText("  THE   HOBBIT  \r\n\n by   J.R.R. Tolkien \n |  "),
    "THE HOBBIT by J.R.R. Tolkien",
  );
});

test("limits normalized OCR output to 200 characters", () => {
  assert.equal(normalizeRecognizedText("A".repeat(250)).length, 200);
});
