import { fetchBookFormatsDirect } from "@/lib/directBookCatalogue";

// Edition metadata is public Open Library data, so it is fetched from the reader's
// browser instead of consuming a Base44 integration/function credit.
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
