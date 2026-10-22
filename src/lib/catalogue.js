// One shape for a book taken from a catalogue, so a result is saved the same way wherever
// the reader picked it up.

// Identifies a result inside one list of results.
export const catalogueKey = (book) => book?.google_books_id || book?.isbn || book?.title;

// A catalogue result turned into the record a shelf holds.
export const recordFromCatalogue = (book, shelfId, format) => ({
  title: book.title,
  author: book.author,
  isbn: book.isbn,
  cover_url: book.cover_url,
  description: book.description,
  publisher: book.publisher,
  published_date: book.published_date,
  page_count: book.page_count,
  categories: book.categories,
  buy_links: book.buy_links,
  google_books_id: book.google_books_id,
  shelf_id: shelfId,
  status: "to_read",
  format,
  formats: [format],
  // A book picked from a catalogue answer arrived with its own details, so it is an enriched
  // record from the moment it is saved.
  enrichment_status: "enriched",
  ...(book.series_name ? { series_name: book.series_name, series_position: book.series_position || "" } : {}),
  // What the supplementary catalogue added to this result — its own readers' average and the
  // record it is held under there — carried onto the shelf so the book's page can show them.
  ...(book.community_rating > 0 ? { community_rating: book.community_rating } : {}),
  ...(book.community_ratings_count > 0 ? { community_ratings_count: book.community_ratings_count } : {}),
  ...(book.hardcover_id ? { hardcover_id: String(book.hardcover_id) } : {}),
});