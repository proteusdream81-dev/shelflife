import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireUser, unauthorized } from '../../shared/requireUser.ts';
import { serverError } from '../../shared/errors.ts';

// Nearby libraries and bookshops, from OpenStreetMap contributors. The geocoder answers in a
// moment when it is well, and the Overpass API is the deeper source behind it, so a lookup is
// asked of the geocoder first and then walked across the public Overpass servers before the
// reader is ever told the service is unavailable.
const PHOTON = 'https://photon.komoot.io/api/';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const USER_AGENT = 'ShelfLife/1.0 (reading companion app; libraries and bookshops nearby)';
const RADIUS_OPTIONS = [1000, 2000, 5000, 10000, 25000, 50000];

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8000;
const PHOTON_TIMEOUT_MS = 6000;
const BACKOFF_MS = [400, 1000];
const TOTAL_BUDGET_MS = 24000; // Under half a minute, whatever the servers do.
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const CACHE_HOURS = 24;
const MAX_PLACES = 40;
const BUSY_MESSAGE = 'The places service is busy right now. Please try again.';

const KINDS = [
  { kind: 'library', osmTag: 'amenity:library', term: 'library' },
  { kind: 'bookshop', osmTag: 'shop:books', term: 'books' },
];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);
    if (!user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const radius = RADIUS_OPTIONS.includes(Number(body.radius)) ? Number(body.radius) : 10000;

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Response.json({ error: 'A valid location is required' }, { status: 400 });
    }

    // One area is looked up once and kept, so the next reader nearby costs no fresh lookup and
    // a burst of the same request never adds to the load on the public servers.
    const key = cacheKey(lat, lon, radius);
    const cached = await readCache(base44, key);
    if (cached && !cached.stale) return Response.json({ places: cached.places, cached: true });

    try {
      const places = await findPlaces(lat, lon, radius);
      // Only a real answer is kept: an empty one could be a server quietly giving up, and
      // keeping it would hide a whole area's libraries for a day.
      if (places.length) await writeCache(base44, key, places);
      return Response.json({ places });
    } catch (error) {
      console.error(`nearbyPlaces: live lookup failed - ${error?.message || error}`);
      // An answer kept from an earlier day is still better than an error when the servers are down.
      if (cached?.places?.length) return Response.json({ places: cached.places, stale: true });
      return Response.json({ error: BUSY_MESSAGE }, { status: 502 });
    }
  } catch (error) {
    return serverError(error, 502, BUSY_MESSAGE);
  }
}

async function findPlaces(lat, lon, radius) {
  const started = Date.now();

  // The geocoder first: it is the quickest answer when it is well.
  try {
    const candidates = await lookupGeocoder(lat, lon, radius, started);
    return tidy(candidates, lat, lon, radius);
  } catch (error) {
    console.error(`nearbyPlaces: geocoder unavailable - ${error?.message || error}`);
  }

  // Then the Overpass servers, which carry the same OpenStreetMap data.
  const elements = await queryOverpass(overpassQuery(lat, lon, radius), started);
  return tidy(overpassCandidates(elements), lat, lon, radius);
}

async function lookupGeocoder(lat, lon, radius, started) {
  const left = TOTAL_BUDGET_MS - (Date.now() - started);
  if (left < 2000) throw new Error('No time left for the geocoder');

  const bbox = boundingBox(lat, lon, radius);
  const timeout = Math.min(PHOTON_TIMEOUT_MS, left);

  const answers = await Promise.all(KINDS.map(async (entry) => {
    const url = `${PHOTON}?q=${encodeURIComponent(entry.term)}&osm_tag=${encodeURIComponent(entry.osmTag)}`
      + `&lat=${lat}&lon=${lon}&bbox=${bbox}&limit=40`;

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);

    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.features)) throw new Error('Geocoder answered without any places');

    return data.features.map((feature) => {
      const props = feature.properties || {};
      const [placeLon, placeLat] = feature.geometry?.coordinates || [];
      return {
        id: `${props.osm_type || 'osm'}/${props.osm_id || `${placeLat},${placeLon}`}`,
        name: props.name,
        kind: entry.kind,
        lat: placeLat,
        lon: placeLon,
        address: formatAddress(props),
      };
    });
  }));

  return answers.flat();
}

// Tries the public Overpass servers in turn, up to three attempts in all, with a short pause
// between them and a deadline that no single request may run past.
async function queryOverpass(query, started) {
  const first = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length);
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);

    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 1000) break;

    const endpoint = OVERPASS_ENDPOINTS[(first + attempt) % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left)),
      });

      if (!response.ok) {
        // A refusal of the query itself is not worth asking another server the same thing.
        throw Object.assign(new Error(`${endpoint} responded ${response.status}`), {
          fatal: !RETRY_STATUSES.has(response.status),
        });
      }

      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.elements)) throw new Error(`${endpoint} answered without any places`);
      return data.elements;
    } catch (error) {
      lastError = error;
      console.error(`nearbyPlaces: attempt ${attempt + 1} on ${endpoint} failed - ${error?.message || error}`);
      if (error?.fatal) break;
    }
  }

  throw lastError || new Error('The places service did not answer in time');
}

function overpassQuery(lat, lon, radius) {
  const bbox = boundingBoxParts(lat, lon, radius);
  return [
    '[out:json][timeout:8]',
    '(',
    `  nwr["amenity"="library"](${bbox});`,
    `  nwr["shop"="books"](${bbox});`,
    ');',
    'out center tags;',
  ].join('\n');
}

function overpassCandidates(elements) {
  return elements.map((element) => {
    const tags = element?.tags || {};
    return {
      id: `osm/${element?.type || 'node'}/${element?.id}`,
      name: tags.name,
      kind: tags.amenity === 'library' ? 'library' : tags.shop === 'books' ? 'bookshop' : '',
      lat: typeof element?.lat === 'number' ? element.lat : element?.center?.lat,
      lon: typeof element?.lon === 'number' ? element.lon : element?.center?.lon,
      address: formatAddress(tags, 'addr:'),
    };
  });
}

// One place per library or bookshop: within the distance asked for, nearest first, and only
// the ones that carry a name a reader could go looking for.
function tidy(candidates, lat, lon, radius) {
  const seen = new Set();
  const places = [];

  for (const candidate of candidates) {
    const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
    const { kind, lat: placeLat, lon: placeLon } = candidate || {};
    if (!kind || !name || typeof placeLat !== 'number' || typeof placeLon !== 'number') continue;

    const key = `${name.toLowerCase()}|${placeLat.toFixed(3)}|${placeLon.toFixed(3)}`;
    if (seen.has(key)) continue;

    const distance = distanceKm(lat, lon, placeLat, placeLon);
    if (distance > radius / 1000) continue;

    seen.add(key);
    places.push({
      id: candidate.id,
      name: name.slice(0, 120),
      kind,
      lat: placeLat,
      lon: placeLon,
      address: candidate.address || '',
      distance_km: Math.round(distance * 10) / 10,
    });
  }

  places.sort((a, b) => a.distance_km - b.distance_km);
  return places.slice(0, MAX_PLACES);
}

function cacheKey(lat, lon, radius) {
  return `places:${lat.toFixed(2)}:${lon.toFixed(2)}:${radius}`;
}

async function readCache(base44, key) {
  try {
    const { items } = await base44.asServiceRole.entities.PlacesCache
      .filter({ cache_key: key }, { sort: '-created_date', limit: 1 });
    const hit = items[0];
    if (!hit || !Array.isArray(hit.places) || !hit.places.length) return null;

    const ageHours = (Date.now() - new Date(hit.created_date).getTime()) / 3600000;
    return { places: hit.places, stale: ageHours > CACHE_HOURS };
  } catch {
    return null; // A cache that cannot be read is a miss, never a failed lookup.
  }
}

async function writeCache(base44, key, places) {
  try {
    await base44.asServiceRole.entities.PlacesCache.create({ cache_key: key, places });
  } catch {
    // Places that were found are still a good answer if they cannot be kept.
  }
}

function boundingBoxParts(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return [
    (lat - latDelta).toFixed(5),
    (lon - lonDelta).toFixed(5),
    (lat + latDelta).toFixed(5),
    (lon + lonDelta).toFixed(5),
  ];
}

// The geocoder takes its box as west,south,east,north.
function boundingBox(lat, lon, radiusMeters) {
  const [south, west, north, east] = boundingBoxParts(lat, lon, radiusMeters);
  return `${west},${south},${east},${north}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// The geocoder names its address parts plainly, OpenStreetMap's own data prefixes them.
function formatAddress(props, prefix = '') {
  const pick = (key) => props[`${prefix}${key}`];
  const street = [pick('housenumber'), pick('street')].filter(Boolean).join(' ');
  const area = pick('suburb') || pick('city') || pick('district') || '';
  return [street, area, pick('postcode')].filter(Boolean).join(', ');
}