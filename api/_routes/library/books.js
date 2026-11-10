import { createLibraryCollectionHandler } from "../../_lib/ownedCollectionHandler.js";
import { createLibraryWriteHandler } from "../../_lib/libraryWriteHandler.js";

const readBooks = createLibraryCollectionHandler({ collection: "books" });
const createBook = createLibraryWriteHandler({ collection: "books", operation: "create" });

export default async function handler(req, res) {
  if (req.method === "POST") return createBook(req, res);
  return readBooks(req, res);
}
