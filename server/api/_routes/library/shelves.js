import { createLibraryCollectionHandler } from "../../_lib/ownedCollectionHandler.js";
import { createLibraryWriteHandler } from "../../_lib/libraryWriteHandler.js";

const readShelves = createLibraryCollectionHandler({ collection: "shelves" });
const createShelf = createLibraryWriteHandler({ collection: "shelves", operation: "create" });

export default async function handler(req, res) {
  if (req.method === "POST") return createShelf(req, res);
  return readShelves(req, res);
}
