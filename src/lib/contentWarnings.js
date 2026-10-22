// Content warnings a reader can tag their own copy of a book with. The common categories are
// listed here so they are spelled the same way everywhere; a reader can also add a tag of
// their own, which is stored in the same list as plain text.

export const CONTENT_WARNINGS = [
  { value: "Violence", label: "Violence" },
  { value: "Sexual content", label: "Sexual content" },
  { value: "Death", label: "Death" },
  { value: "Self-harm", label: "Self-harm" },
  { value: "Substance use", label: "Substance use" },
  { value: "Animal harm", label: "Animal harm" },
  { value: "Miscarriage / infertility", label: "Miscarriage / infertility" },
  { value: "Abuse", label: "Abuse" },
  { value: "Mental illness", label: "Mental illness" },
  { value: "War", label: "War" },
];

export const MAX_WARNING_TAGS = 12;
export const MAX_WARNING_LENGTH = 48;

// Everything tagged on one book, in the order it was tagged, without blanks or repeats.
export const warningsOf = (book) => {
  const listed = Array.isArray(book?.content_warnings) ? book.content_warnings : [];
  return [...new Set(listed.map((tag) => String(tag || "").trim()).filter(Boolean))];
};

export const hasCommonWarning = (tag) =>
  CONTENT_WARNINGS.some((warning) => warning.value.toLowerCase() === String(tag || "").toLowerCase());