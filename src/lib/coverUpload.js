// Phone cameras often produce multi-megabyte HEIC/JPEG files. Uploading them raw fails on
// some devices and networks. Shrink and re-encode to JPEG on the device first, the same way
// cover scans are prepared, so UploadPublicFile always receives a modest, widely supported file.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_BYTES = 4 * 1024 * 1024; // soft ceiling after encode; still try if slightly over

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });

const canvasToJpegFile = (canvas, name) =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const base = String(name || "cover").replace(/\.[^.]+$/, "") || "cover";
        resolve(new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });

/**
 * Prepare a user-picked image for cover upload: decode, downscale, re-encode as JPEG.
 * If the browser cannot decode the file (some HEIC paths), returns the original file so the
 * upload can still be attempted rather than failing silently on the client.
 */
export async function prepareCoverFile(file) {
  if (!file) return null;

  // Already small JPEGs can pass through after a size check, but re-encoding still helps
  // strip EXIF orientation issues on some Android WebViews.
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    return file;
  }

  const { img, url } = loaded;
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width || 1, img.height || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const prepared = await canvasToJpegFile(canvas, file.name);
    if (!prepared) return file;

    // Prefer the smaller of original vs prepared when original is already a tiny JPEG.
    if (file.type === "image/jpeg" && file.size > 0 && file.size <= prepared.size && file.size <= MAX_BYTES) {
      return file;
    }
    return prepared;
  } finally {
    URL.revokeObjectURL(url);
  }
}
