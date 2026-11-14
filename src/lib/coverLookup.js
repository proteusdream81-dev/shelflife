import { recognizeCoverText } from "./coverOcr.js";
import { searchBooksDirect } from "./directBookCatalogue.js";
import { booksFromSearch } from "./searchResult.js";

// Prefer on-device OCR plus public catalogues. Keep the existing hosted vision
// function as a fallback for low-quality covers and OCR/catalogue misses until
// its original implementation is recovered and parity can be verified.
export async function lookupCoverPhoto(image, {
  recognize = recognizeCoverText,
  search = searchBooksDirect,
  legacyIdentify = null,
} = {}) {
  let recognizedText = "";
  try {
    recognizedText = String(await recognize(image) || "").trim().slice(0, 200);
  } catch {
    // The legacy vision fallback may still be able to read a photo that local OCR cannot.
  }

  if (recognizedText) {
    try {
      const result = await search(recognizedText, "all");
      const books = booksFromSearch(result);
      if (books.length) return { books, guess: { title: recognizedText }, source: "direct-catalogue" };
    } catch {
      // A catalogue outage or weak OCR match should not block the legacy fallback.
    }
  }

  if (typeof legacyIdentify === "function") {
    const result = await legacyIdentify(image);
    const books = booksFromSearch(result);
    return { books, guess: result.guess || {}, source: "legacy-fallback" };
  }

  return { books: [], guess: { title: recognizedText }, source: "direct-catalogue" };
}
