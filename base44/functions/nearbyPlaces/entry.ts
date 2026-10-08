import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Nearby libraries and bookshops, from OpenStreetMap contributors via the Photon geocoder.
const ENDPOINT = 'https://photon.komoot.io/api/';
const USER_AGENT = 'ShelfLife/1.0 (reading companion app)';
const LIMIT_PER_KIND = 40;
const RADIUS_OPTIONS = [1000, 2000, 5000, 10000, 25000, 50000];

const KINDS = [
  { kind: 'library', osmTag: 'amenity:library', term: 'library' },
  { kind: 'bookshop', osmTag: 'shop:books', term: 'books' },
];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const radius = RADIUS_OPTIONS.includes(Number(body.radius)) ? Number(body.radius) : 10000;

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Response.json({ error: 'A valid location is required' }, { status: 400 });
    }

    const bbox = boundingBox(lat, lon, radius);
    const settled = await Promise.allSettled(KINDS.map((entry) => lookup(entry, lat, lon, bbox)));
    if (settled.every((result) => result.status === 'rejected')) {
      return Response.json({ error: 'The places service is busy right now. Please try again.' }, { status: 502 });
    }

    const seen = new Set();
    const places = [];

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const place of result.value) {
        const key = `${place.name.toLowerCase()}|${place.lat.toFixed(3)}|${place.lon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const distance = distanceKm(lat, lon, place.lat, place.lon);
        if (distance > radius / 1000) continue;

        places.push({ ...place, distance_km: Math.round(distance * 10) / 10 });
      }
    }

    places.sort((a, b) => a.distance_km - b.distance_km);
    return Response.json({ places: places.slice(0, 40) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function lookup(entry, lat, lon, bbox) {
  const url = `${ENDPOINT}?q=${encodeURIComponent(entry.term)}&osm_tag=${encodeURIComponent(entry.osmTag)}`
    + `&lat=${lat}&lon=${lon}&bbox=${bbox}&limit=${LIMIT_PER_KIND}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Places service responded ${response.status}`);

  const data = await response.json().catch(() => null);
  const places = [];

  for (const feature of data?.features || []) {
    const props = feature.properties || {};
    const [placeLon, placeLat] = feature.geometry?.coordinates || [];
    if (!props.name || typeof placeLat !== 'number' || typeof placeLon !== 'number') continue;

    places.push({
      id: `${props.osm_type || 'osm'}/${props.osm_id || `${placeLat},${placeLon}`}`,
      name: props.name,
      kind: entry.kind,
      lat: placeLat,
      lon: placeLon,
      address: formatAddress(props),
    });
  }

  return places;
}

function boundingBox(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta]
    .map((value) => value.toFixed(5))
    .join(',');
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAddress(props) {
  const street = [props.housenumber, props.street].filter(Boolean).join(' ');
  const area = props.suburb || props.city || props.district || '';
  return [street, area, props.postcode].filter(Boolean).join(', ');
}