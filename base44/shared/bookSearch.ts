// Shared Open Library search, used by searchBooks and identifyBook.

const FIELDS = 'title,author_name,isbn,publisher,publish_year,first_publish_year,number_of_pages_median,cover_edition_key,subject,edition_key,key';

export function normalizeDoc(d) {
  const isbn = Array.isArray(d.isbn) ? (d.isbn.find((i) => i.length === 13) || d.isbn[0]) : '';
  let cover = '';
  if (d.cover_edition_key) cover = `https://covers.openlibrary.org/b/olid/${d.cover_edition_key}-M.jpg`;
  else if (isbn) cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

  const buyLinks = [];
  if (isbn) {
    buyLinks.push({ name: 'Bookfinder', url: `https://www.bookfinder.com/search/?isbn=${isbn}&mode=isbn&st=sr&ac=qr` });
    buyLinks.push({ name: 'Amazon', url: `https://www.amazon.com/s?k=${isbn}` });
  }

  const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');
  const publisher = Array.isArray(d.publisher) ? d.publisher[0] : (d.publisher || '');
  const year = d.first_publish_year || (Array.isArray(d.publish_year) ? d.publish_year[0] : d.publish_year) || '';

  return {
    google_books_id: d.key || (Array.isArray(d.edition_key) ? d.edition_key[0] : '') || isbn || '',
    title: d.title || '',
    author,
    isbn,
    cover_url: cover,
    description: '',
    publisher,
    published_date: String(year || ''),
    page_count: d.number_of_pages_median || 0,
    categories: Array.isArray(d.subject) ? d.subject.slice(0, 5) : [],
    buy_links: buyLinks,
  };
}

export async function searchOpenLibrary(query, type) {
  const kind = type || 'all';
  let q = query;
  if (kind === 'title') q = `title:${query}`;
  else if (kind === 'author') q = `author:${query}`;
  else if (kind === 'isbn') q = `isbn:${String(query).replace(/[^0-9Xx]/g, '')}`;

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=${FIELDS}&limit=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const error = new Error('Book lookup failed');
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return (data.docs || []).map(normalizeDoc).filter((b) => b && b.title);
}