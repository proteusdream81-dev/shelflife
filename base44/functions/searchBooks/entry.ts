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
    if (searchType === 'title') q = `intitle:${query}`;
    else if (searchType === 'author') q = `inauthor:${query}`;
    else if (searchType === 'isbn') q = `isbn:${query.replace(/[^0-9Xx]/g, '')}`;

    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return Response.json({ error: 'Book search failed' }, { status: 502 });
    const data = await res.json();
    const books = (data.items || []).map(normalizeVolume).filter((b) => b && b.title);
    return Response.json({ books });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function normalizeVolume(item) {
  const v = item.volumeInfo || {};
  const sale = item.saleInfo || {};
  let isbn = '';
  if (Array.isArray(v.industryIdentifiers)) {
    const isbn13 = v.industryIdentifiers.find((i) => i.type === 'ISBN_13');
    const isbn10 = v.industryIdentifiers.find((i) => i.type === 'ISBN_10');
    isbn = (isbn13 || isbn10 || {}).identifier || '';
  }
  let cover = '';
  if (v.imageLinks) {
    cover = v.imageLinks.extraLarge || v.imageLinks.large || v.imageLinks.medium || v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || '';
  }
  if (cover) cover = cover.replace(/^http:/, 'https:');
  const buyLinks = [];
  if (sale.buyLink) buyLinks.push({ name: 'Google Play', url: sale.buyLink });
  if (Array.isArray(sale.offers)) {
    for (const o of sale.offers) {
      if (o.buyLink) buyLinks.push({ name: (o.retailer && o.retailer.name) || 'Google Play', url: o.buyLink });
    }
  }
  return {
    google_books_id: item.id || '',
    title: v.title || '',
    author: Array.isArray(v.authors) ? v.authors.join(', ') : (v.author || ''),
    isbn,
    cover_url: cover,
    description: v.description || '',
    publisher: v.publisher || '',
    published_date: v.publishedDate || '',
    page_count: v.pageCount || 0,
    categories: Array.isArray(v.categories) ? v.categories : [],
    buy_links: buyLinks,
  };
}