// Read text from a cover photo on the reader's device. The image is never uploaded.
// Tesseract.js and its English language data are downloaded as browser assets on first use.
const MAX_COVER_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let workerPromise;

export function validateCoverImage(imageFile) {
  if (!imageFile || typeof imageFile !== "object") {
    throw new Error("Choose a photo of the book cover.");
  }
  if (!SUPPORTED_COVER_TYPES.has(String(imageFile.type || "").toLowerCase())) {
    throw new Error("Use a JPEG, PNG or WebP photo of the book cover.");
  }
  if (!Number.isFinite(imageFile.size) || imageFile.size <= 0) {
    throw new Error("The selected photo is empty. Choose another image.");
  }
  if (imageFile.size > MAX_COVER_IMAGE_BYTES) {
    throw new Error("That photo is larger than 12 MB. Choose a smaller image.");
  }
  return true;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js");
      return createWorker("eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        gzip: true,
      });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function recognizeCoverText(imageFile) {
  validateCoverImage(imageFile);
  let worker;
  try {
    worker = await getWorker();
  } catch {
    throw new Error("On-device cover recognition could not load. Check your internet connection, or use the barcode or ISBN option.");
  }

  let result;
  try {
    result = await worker.recognize(imageFile);
  } catch {
    throw new Error("We couldn't process that cover photo. Try a clearer image, or use the barcode or ISBN option.");
  }

  return String(result?.data?.text || "")
    .split(/\\r?\\n/)
    .map((line) => line.replace(/[|_~]+/g, " ").replace(/\\s+/g, " ").trim())
    .filter((line) => line.length >= 3)
    .slice(0, 18)
    .join(" ")
    .slice(0, 200);
}
