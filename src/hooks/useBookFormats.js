import { useCallback, useRef, useState } from "react";
import { fetchFormats } from "@/lib/bookFormats";

const keyOf = (book) => book?.google_books_id || book?.isbn || book?.title || "";

// The formats each book is published in, asked for once per book and kept for the life
// of the panel that shows them.
export default function useBookFormats() {
  const [formats, setFormats] = useState({});
  const asked = useRef(new Set());

  const load = useCallback(async (books, limit = 5) => {
    const list = (Array.isArray(books) ? books : [books]).filter(Boolean).slice(0, limit);

    await Promise.all(list.map(async (book) => {
      const key = keyOf(book);
      if (!key || asked.current.has(key)) return;
      asked.current.add(key);
      const found = await fetchFormats(book);
      setFormats((prev) => ({ ...prev, [key]: found }));
    }));
  }, []);

  return { formats, load };
}