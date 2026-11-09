import test from "node:test";
import assert from "node:assert/strict";
import {
  searchBooksDirect,
  fetchBookFormatsDirect,
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

test("rejects an empty catalogue query before making network requests", async () => {
  let calls = 0;
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
