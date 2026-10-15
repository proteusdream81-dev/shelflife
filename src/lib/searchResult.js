// What a search replies with. A backend function that fails is meant to fail loudly, but a
// reply carrying no list of books at all has failed too — showing "no books found" for it
// would hide the fault behind an empty screen.

export function booksFromSearch(data) {
  if (!data || !Array.isArray(data.books)) {
    throw new Error("The book catalogues didn't answer properly.");
  }
  return data.books;
}

// True when a catalogue was missing from the answer, so a short list is reported as a lookup
// that partly failed rather than as a search that found nothing.
export const searchWasPartial = (data) => data?.partial === true;