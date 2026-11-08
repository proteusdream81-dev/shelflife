import { fetchBookFormatsDirect } from "@/lib/directBookCatalogue";

// Edition metadata is public Open Library data, fetched from the reader's browser.
export async function fetchFormats(book) {
  try {
    return await fetchBookFormatsDirect({
      isbn: book?.isbn || "",
      title: book?.title || "",
      author: book?.author || "",
    });
  } catch {
    return [];
  }
}
