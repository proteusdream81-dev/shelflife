import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

// The subjects a club can be filed under. Kept in step with src/lib/clubCategories.js — a
// function may not reach into the frontend — so a club found out in the world is filed
// with the same words as a club started inside the app.
const CATEGORIES = [
  'Romance',
  'Fantasy',
  'Science fiction',
  'Mystery & thriller',
  'Literary fiction',
  'Historical fiction',
  'Horror',
  'Young adult',
  'Non-fiction',
  'Biography & memoir',
  'Classics',
  'Poetry',
  'Self-development',
];

const MAX_CLUBS = 12;
const CACHE_DAYS = 21;

// Clubs that exist out in the world: reading groups in libraries, bookshops, community
// centres and on the internet that a reader could actually walk into or log into. They are
// found in public listings rather than a database of ours, so every club comes back with
// the page it was found on and the reader joins it there.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const category = CATEGORIES.includes(body.category) ? body.category : '';
    const location = (body.location || '').toString().trim().slice(0, 80);
    if (!category && !location) {
      return Response.json({ error: 'Pick a subject or type a place to search' }, { status: 400 });
    }

    // Clubs come and go slowly, so one look at a subject and a place is kept and served to
    // the next reader who searches the same thing. The answer is a public listing, never
    // anything about the reader who asked.
    const key = `clubs:${category.toLowerCase()}|${location.toLowerCase()}`.slice(0, 200);
    const cached = await readCachedClubs(base44, key);
    if (cached) return Response.json({ clubs: cached });

    const clubs = await findClubs(base44, category, location);
    await writeCachedClubs(base44, key, clubs);
    return Response.json({ clubs });
  } catch (error) {
    return serverError(error, 502, 'We could not look up clubs right now. Please try again.');
  }
}

async function findClubs(base44, category, location) {
  const subject = category ? `about ${category} books` : 'about any kind of book';
  const place = location
    ? `They must be in or near ${location}, or run online so a reader there can join from home.`
    : 'They may be anywhere in the world, as long as a new member can join, including clubs that meet online.';

  const prompt = [
    'Find real book clubs that a reader could join right now.',
    `The clubs must be ${subject}. ${place}`,
    '',
    'Look through public listings and calendars for these: Meetup, Bookclubs.com, public library event calendars (city and council library websites), independent bookshop clubs, university and community centre programmes, The StoryGraph and Goodreads groups, book-related subreddits, and Discord communities with a public invite page.',
    location
      ? `Start with ${location} itself: its library service event calendar, its Meetup groups, and its bookshop and community centre programmes.`
      : 'With no place named, draw on online clubs and the well-known public listings.',
    '',
    'Rules:',
    '- Each club is one particular group with its own members and meetings. Never return a directory page that lists many clubs in place of the clubs themselves.',
    '- Only clubs that are active now and genuinely open to a new member, and only when you have found their public page.',
    '- Every club must carry the exact https URL of that page. Never guess, shorten or invent a URL, and never reuse a site\'s home page in place of the club\'s own page. If you have no page for a club, leave the club out entirely.',
    '- File each club under one subject from the list you were given. If none fits exactly, pick the closest one.',
    '- "where" is "Online" for a club that meets on the internet, or the town and country for one that meets in person.',
    '- Say in "meets" how often and when it meets, if the listing says so, and name the site you found it on in "source".',
    '- Prefer clubs from several different sources rather than several from one group.',
    `- Return up to ${MAX_CLUBS} clubs, the strongest first, and aim for at least six whenever the listings can carry them.`,
    location
      ? '- Put the clubs in or near that place first, then the online clubs a reader there could join.'
      : '- Order the clubs by how good a fit they are for the subject.',
    '- Answer with JSON matching the schema, and nothing else.',
  ].join('\n');

  const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    add_context_from_internet: true,
    response_json_schema: {
      type: 'object',
      properties: {
        clubs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              category: { type: 'string', enum: CATEGORIES },
              where: { type: 'string' },
              meets: { type: 'string' },
              description: { type: 'string' },
              source: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['name', 'category', 'where', 'description', 'source', 'url'],
          },
        },
      },
      required: ['clubs'],
    },
  });

  return tidyClubs(response?.clubs);
}

// A club is only worth showing if its page can be opened and its words fit a card, so a
// club with no page of its own is dropped rather than offered as a dead end.
function tidyClubs(clubs) {
  if (!Array.isArray(clubs)) return [];

  const seen = new Set();
  const cleaned = [];

  for (const club of clubs) {
    const url = webUrl(club?.url);
    const name = text(club?.name, 120);
    if (!url || !name || seen.has(url)) continue;

    seen.add(url);
    cleaned.push({
      name,
      category: CATEGORIES.includes(club.category) ? club.category : '',
      where: text(club.where, 80),
      meets: text(club.meets, 120),
      description: text(club.description, 320),
      source: text(club.source, 60),
      url,
    });
    if (cleaned.length >= MAX_CLUBS) break;
  }

  return cleaned;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Only a page a reader can open in a browser: an answer of a bare domain, a mailto: address
// or a javascript: URL gives them nothing, or worse.
function webUrl(value) {
  const raw = text(value, 500);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

async function readCachedClubs(base44, key) {
  try {
    const { items } = await base44.asServiceRole.entities.ClubSearchCache
      .filter({ cache_key: key }, { sort: '-created_date', limit: 1 });
    const hit = items[0];
    if (!hit || !Array.isArray(hit.clubs) || !hit.clubs.length) return null;

    const ageDays = (Date.now() - new Date(hit.created_date).getTime()) / 86400000;
    return ageDays > CACHE_DAYS ? null : hit.clubs;
  } catch {
    return null; // A cache that cannot be read is a miss, never a failed search.
  }
}

async function writeCachedClubs(base44, key, clubs) {
  if (!clubs.length) return; // An empty answer is not worth keeping.
  try {
    await base44.asServiceRole.entities.ClubSearchCache.create({ cache_key: key, clubs });
  } catch {
    // Clubs that were found are still a good answer if they cannot be kept.
  }
}