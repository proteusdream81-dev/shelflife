// Cover photos exist only to be identified, so shrink them on the device before
// they are sent: a phone capture can otherwise run to several megabytes.
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

const readAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read that photo"));
    reader.readAsDataURL(file);
  });

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo"));
    };
    img.src = url;
  });

export async function toScanBase64(file) {
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    // Formats the canvas can't decode (some HEIC photos) go up as they are.
    return readAsBase64(file);
  }

  const { img, url } = loaded;
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  const shrunk = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return readAsBase64(shrunk || file);
}