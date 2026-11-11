import test from "node:test";
import assert from "node:assert/strict";
import {
  searchBooksDirect,
  fetchBookFormatsDirect,
  fetchBookSeriesDirect,
  fetchAuthorReleasesDirect,
  fetchAuthorReleaseCalendarDirect,
  pickReleaseDate,
  fetchBookCoversDirect,
} from "./directBookCatalogue.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withFetch(t, implementation) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => { globalThis.fetch = original; });
}

test("rejects an empty catalogue query before making network requests", async (t) => {
  let calls = 0;
  withFetch(t, async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(
    () => searchBooksDirect("   "),
    /Enter a title, author or ISBN/,
  );
  assert.equal(calls, 0);
});

test("combines Google Books and Open Library results and removes duplicate ISBNs", async (t) => {
  const requested = [];
  withFetch(t, async (url) => {
    requested.push(String(url));
    if (String(url).startsWith("https://www.googleapis.com/")) {
      return response({ items: [{
        id: "google-volume-1",
        volumeInfo: {
          title: "The Left Hand of Darkness",
          authors: ["Ursula K. Le Guin"],
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780441007318" }],
          imageLinks: { thumbnail: "http://books.example/cover.jpg" },
        },
      }] });
    }
    return response({ docs: [
      { title: "The Left Hand of Darkness", author_name: ["Ursula K. Le Guin"], isbn: ["9780441007318"] },
      { title: "A Wizard of Earthsea", author_name: ["Ursula K. Le Guin"], isbn: ["9780547773742"] },
    ] });
  });

  const result = await searchBooksDirect("Ursula K. Le Guin", "author");

  assert.equal(result.partial, false);
  assert.equal(result.books.length, 2);
  assert.equal(result.books[0].google_books_id, "google-volume-1");
  assert.equal(result.books[0].cover_url, "https://books.example/cover.jpg");
  assert.equal(result.books[1].title, "A Wizard of Earthsea");
  assert.equal(requested.length, 2);
  assert.match(requested[1], /author%3AUrsula/);
});

test("returns available results and marks the search partial when one catalogue fails", async (t) => {
  withFetch(t, async (url) => {
    if (String(url).startsWith("https://www.googleapis.com/")) {
      return response({ items: [{ id: "g1", volumeInfo: { title: "Dune" } }] });
    }
    return response({ error: "temporarily unavailable" }, 503);
  });

  const result = await searchBooksDirect("Dune");

  assert.equal(result.partial, true);
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].title, "Dune");
});

test("reports a useful error when both catalogues fail", async (t) => {
  withFetch(t, async () => response({ error: "offline" }, 503));
  await assert.rejects(
    () => searchBooksDirect("Dune"),
    /Neither Google Books nor Open Library could be reached/,
  );
});

test("looks up Open Library editions and returns recognized formats in stable order", async (t) => {
  const requested = [];
  withFetch(t, async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("/isbn/")) {
      return response({ works: [{ key: "/works/OL123W" }] });
    }
    return response({ entries: [
      { physical_format: "Hardcover" },
      { physical_format: "Paperback" },
      { physical_format: "E-book" },
      { physical_format: "Paperback" },
      { physical_format: "Audiobook" },
    ] });
  });

  const formats = await fetchBookFormatsDirect({ isbn: "9780441007318" });

  assert.deepEqual(formats, ["paperback", "hardcover", "ebook", "audiobook"]);
  assert.equal(requested.length, 2);
  assert.ok(requested[1].includes("/works/OL123W/editions.json"));
});


test("reads a series annotation from the title without a catalogue request", async (t) => {
  let calls = 0;
  withFetch(t, async () => { calls += 1; return response({}); });
  const series = await fetchBookSeriesDirect({ title: "Iron Flame (The Empyrean, #2)" });
  assert.deepEqual(series, { series_name: "The Empyrean", series_position: "2" });
  assert.equal(calls, 0);
});

test("ranks Open Library edition series using English evidence and frequency", async (t) => {
  const requested = [];
  withFetch(t, async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("/isbn/")) return response({ works: [{ key: "/works/OL123W" }] });
    return response({ entries: [
      { series: ["Saga of the North, 1"], languages: [{ key: "/languages/eng" }] },
      { series: ["Saga of the North, 2"], languages: [{ key: "/languages/eng" }] },
      { series: ["Saga of the North"], languages: [{ key: "/languages/eng" }] },
      { series: ["Nordensaga, 1"], languages: [{ key: "/languages/swe" }] },
    ] });
  });
  const series = await fetchBookSeriesDirect({ isbn: "9780441007318" });
  assert.deepEqual(series, { series_name: "Saga of the North", series_position: "1" });
  assert.equal(requested.length, 2);
  assert.ok(requested[1].includes("/works/OL123W/editions.json"));
});

test("returns an empty series result when Open Library has no matching work", async (t) => {
  withFetch(t, async () => response({ docs: [] }));
  assert.deepEqual(await fetchBookSeriesDirect({ title: "Uncatalogued title" }), {});
});


test("parses only day-precision release dates", () => {
  assert.equal(pickReleaseDate(["2026", "October 4, 2026"]), "2026-10-04");
  assert.equal(pickReleaseDate("4 October 2026"), "2026-10-04");
  assert.equal(pickReleaseDate("2026-10-04"), "2026-10-04");
  assert.equal(pickReleaseDate(["2026", "October 2026"]), "");
  assert.equal(pickReleaseDate("not a date"), "");
});

test("fetches author release editions and normalizes cover and ISBN metadata", async (t) => {
  let requested = "";
  withFetch(t, async (url) => {
    requested = String(url);
    return response({ docs: [
      {
        title: "New Book",
        author_name: ["Test Author"],
        publish_date: ["2026", "October 4, 2026"],
        isbn: ["9780441007318"],
        cover_edition_key: "OL123M",
        key: "/works/OL123W",
      },
      { title: "Undated Book", author_name: ["Test Author"], publish_date: ["2026"] },
    ] });
  });
  const result = await fetchAuthorReleasesDirect("Test Author");
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-10-04");
  assert.equal(result[0].book.title, "New Book");
  assert.equal(result[0].book.isbn, "9780441007318");
  assert.match(result[0].book.cover_url, /OL123M-M.jpg$/);
  assert.match(requested, /sort=new/);
  assert.match(requested, /publish_date/);
});

test("builds an author calendar with deduplicated authors, date window and earliest title date", async (t) => {
  const requested = [];
  withFetch(t, async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("First%20Author") || value.includes("First%20Author")) {
      return response({ docs: [
        { title: "Upcoming", author_name: ["First Author"], publish_date: ["2026-08-01"], key: "/works/one" },
        { title: "Upcoming", author_name: ["First Author"], publish_date: ["2026-07-01"], key: "/works/two" },
        { title: "Too Old", author_name: ["First Author"], publish_date: ["2024-01-01"] },
        { title: "Too Far", author_name: ["First Author"], publish_date: ["2030-01-01"] },
      ] });
    }
    return response({ docs: [
      { title: "Second Release", author_name: ["Second Author"], publish_date: ["2026-09-01"], key: "/works/three" },
    ] });
  });
  const result = await fetchAuthorReleaseCalendarDirect([
    { author: "First Author" },
    { author: "first author" },
    { author: "Second Author" },
  ], { now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(result.authors_total, 2);
  assert.equal(result.authors_scanned, 2);
  assert.deepEqual(result.releases.map((release) => [release.title, release.date]), [
    ["Upcoming", "2026-07-01"],
    ["Second Release", "2026-09-01"],
  ]);
  assert.equal(requested.length, 2);
});

test("caps the author calendar at 24 unique authors and tolerates partial provider failures", async (t) => {
  let calls = 0;
  withFetch(t, async (url) => {
    calls += 1;
    if (String(url).includes("Author%201")) return response({ error: "unavailable" }, 503);
    return response({ docs: [] });
  });
  const books = Array.from({ length: 26 }, (_, index) => ({ author: `Author ${index + 1}` }));
  const result = await fetchAuthorReleaseCalendarDirect(books, { now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(result.authors_total, 26);
  assert.equal(result.authors_scanned, 24);
  assert.equal(calls, 24);
  assert.deepEqual(result.releases, []);
});

test("returns an empty author calendar without a network request when no authors exist", async (t) => {
  let calls = 0;
  withFetch(t, async () => { calls += 1; return response({ docs: [] }); });
  assert.deepEqual(await fetchAuthorReleaseCalendarDirect([{ author: "" }]), {
    releases: [], authors_scanned: 0, authors_total: 0,
  });
  assert.equal(calls, 0);
});


test("fetches distinct Google Books and Open Library edition covers in stable order", async (t) => {
  const requested = [];
  withFetch(t, async (url) => {
    const value = String(url);
    requested.push(value);
    if (value.includes("/isbn/")) return response({ works: [{ key: "/works/OL123W" }] });
    return response({ entries: [
      { cover_i: 123, covers: [123, 456] },
      { covers: [789, -1, 0] },
    ] });
  });
  const covers = await fetchBookCoversDirect({
    isbn: "9780441007318",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    google_books_id: "google-volume-1",
  });
  assert.equal(covers.length, 4);
  assert.match(covers[0], /books\.google\.com\/books\/content\?id=google-volume-1/);
  assert.deepEqual(covers.slice(1), [
    "https://covers.openlibrary.org/b/id/123-L.jpg",
    "https://covers.openlibrary.org/b/id/456-L.jpg",
    "https://covers.openlibrary.org/b/id/789-L.jpg",
  ]);
  assert.equal(requested.length, 2);
});

test("returns the Google Books cover when Open Library has no work match", async (t) => {
  withFetch(t, async () => response({ docs: [] }));
  const covers = await fetchBookCoversDirect({ title: "Unknown title", google_books_id: "google-id" });
  assert.equal(covers.length, 1);
  assert.match(covers[0], /id=google-id/);
});
