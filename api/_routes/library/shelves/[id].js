import { createLibraryWriteHandler } from "../../_lib/libraryWriteHandler.js";

export default function handler(req, res) {
  const operation = req.method === "DELETE" ? "delete" : "update";
  return createLibraryWriteHandler({ collection: "shelves", operation })(req, res);
}
