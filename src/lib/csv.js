// Minimal RFC4180-style reader for the library exports this app accepts. Exports from
// different services use different separators — Goodreads and StoryGraph use commas,
// LibraryThing uses tabs — so the separator is read off the header line.
function readDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The separator that splits the header into the most columns wins.
export function detectDelimiter(text) {
  const header = String(text || "").split("\n")[0] || "";
  const counts = [",", "\t", ";"].map((d) => ({ d, n: header.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ",";
}

export function parseCsv(text, delimiter) {
  return readDelimited(text, delimiter || detectDelimiter(text));
}

export const parseDelimited = parseCsv;

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c && c.trim()))
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
      return obj;
    });
}