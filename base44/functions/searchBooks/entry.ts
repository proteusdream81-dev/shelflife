import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const query = (body.query || '').toString().trim();
    if (!query) return Response.json({ error: 'Query is required' }, { status: 400 });
    const searchType = ['all', 'title', 'author', 'isbn'].includes(body.type) ? body.type : 'all';

    let q = query;
    if (searchType === 'title') q = `title:${query}`;
    else if (searchType === 'author') q = `author:${query}`;
    else if (searchType === 'isbn') q = `isbn:${query.replace(/[^0-9Xx]/g, '')}`;

    const fields = 'title,author_name,isbn,publisher,publish_year,first_publish_year,number_of_pages_median,cover_edition_key,subject,edition_key,key';
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=${fields}&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return Response.json({ error: 'Book search failed', status: res.status, detail: detail.slice(0, 200) }, { status: 502 });
    }
    const data = await res.json();
    const books = (data.docs || []).map(normalizeDoc).filter((b) => b && b.title);
    return Response.json({ books });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function normalizeDoc(d) {
  const isbn = Array.isArray(d.isbn) ? (d.isbn.find((i) => i.length === 13) || d.isbn[0]) : '';
  let cover = '';
  if (d.cover_edition_key) cover = `https://covers.openlibrary.org/b/olid/${d.cover_edition_key}-M.jpg`;
  else if (isbn) cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');
  const publisher = Array.isArray(d.publisher) ? d.publisher[0] : (d.publisher || '');
  const year = d.first_publish_year || (Array.isArray(d.publish_year) ? d.publish_year[0] : d.publish_year) || '';
  const buyLinks = [];
  if (isbn) {
    buyLinks.push({ name: 'Bookfinder', url: `https://www.bookfinder.com/search/?isbn=${isbn}&mode=isbn&st=sr&ac=qr` });
    buyLinks.push({ name: 'Amazon', url: `https://www.amazon.com/s?k=${isbn}` });
  }
  return {
    google_books_id: d.key || (Array.isArray(d.edition_key) ? d.edition_key[0] : '') || isbn || '',
    title: d.title || '',
    author,
    isbn,
    cover_url: cover,
    description: '',
    publisher,
    published_date: String(year),
    page_count: d.number_of_pages_median || 0,
    categories: Array.isArray(d.subject) ? d.subject.slice(0, 5) : [],
    buy_links: buyLinks,
  };
}