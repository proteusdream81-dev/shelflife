import { createLibraryWriteHandler } from "../../_lib/libraryWriteHandler.js";

export default createLibraryWriteHandler({ collection: "books", operation: "update" });
