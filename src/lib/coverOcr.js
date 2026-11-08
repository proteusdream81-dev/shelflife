// Read text from a cover photo on the reader's device. The image is never uploaded.
// Tesseract.js and its English language data are downloaded as browser assets on first use.
let workerPromise;

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
  if (!imageFile || !String(imageFile.type || "").startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG or other image of the book cover.");
  }
  const worker = await getWorker();
  const result = await worker.recognize(imageFile);
  return String(result?.data?.text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[|_~]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3)
    .slice(0, 18)
    .join(" ")
    .slice(0, 200);
}
