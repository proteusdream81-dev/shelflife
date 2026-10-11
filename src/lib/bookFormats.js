import { base44 } from "@/api/base44Client";

// The formats a book is published in, asked of the catalogue the first time a reader
// picks it. A miss simply means nothing is shown — never a failed add.
export async function fetchFormats(book) {
  try {
    const res = await base44.functions.invoke("bookFormats", {
      isbn: book?.isbn || "",
      title: book?.title || "",
      author: book?.author || "",
    });
    return Array.isArray(res?.data?.formats) ? res.data.formats : [];
  } catch {
    return [];
  }
}