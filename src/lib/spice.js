// Spice: the reader's own heat rating for a book, 0 to 5, kept on their copy rather than on
// the title, and private until they choose to share it with their reading circle.

export const MAX_SPICE = 5;

const LABELS = ["No spice", "Fade to black", "Warm", "Steamy", "Hot", "Open door"];

export const spiceOf = (book) => {
  const value = Math.round(Number(book?.spice_rating) || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_SPICE);
};

export const spiceLabel = (value) => LABELS[Math.min(Math.max(Math.round(Number(value) || 0), 0), MAX_SPICE)];

// Romance subgenres, so a romance read is tagged with the kind of romance it is rather than
// filed under one broad label.
export const ROMANCE_SUBGENRES = [
  { value: "contemporary", label: "Contemporary" },
  { value: "dark", label: "Dark" },
  { value: "fantasy", label: "Fantasy" },
  { value: "romantasy", label: "Romantasy" },
  { value: "historical", label: "Historical" },
  { value: "paranormal", label: "Paranormal" },
  { value: "science fiction", label: "Science fiction" },
  { value: "romantic comedy", label: "Romantic comedy" },
  { value: "sports", label: "Sports" },
  { value: "small town", label: "Small town" },
  { value: "other", label: "Other romance" },
];

export const subgenreLabel = (value) =>
  ROMANCE_SUBGENRES.find((option) => option.value === value)?.label || "";

// A book counts as romance when its catalogues say so, when the reader has tagged a subgenre,
// or when they have given it any spice at all.
export const isRomance = (book) => {
  if (book?.romance_subgenre) return true;
  if (Number(book?.spice_rating) > 0) return true;
  const categories = Array.isArray(book?.categories) ? book.categories.join(" ") : "";
  return /romance|romantasy/i.test(categories);
};