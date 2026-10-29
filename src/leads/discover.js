// Discovery from OpenStreetMap (open data, Overpass API): US businesses in high-ticket niches that
// list a website. One polite query per niche per city, spaced out.
const OVERPASS = 'https://overpass-api.de/api/interpreter';

export const CITIES = {
  Austin: [30.1, -97.95, 30.52, -97.55],
  Phoenix: [33.29, -112.32, 33.75, -111.92],
  Charlotte: [35.05, -81.01, 35.4, -80.65],
  Dallas: [32.62, -97.0, 33.02, -96.55],
  Houston: [29.55, -95.75, 30.05, -95.15],
  Tampa: [27.85, -82.6, 28.15, -82.3],
  Atlanta: [33.65, -84.55, 33.9, -84.25],
  Denver: [39.6, -105.1, 39.85, -104.75],
  Nashville: [36.0, -86.95, 36.3, -86.6],
  'San Antonio': [29.3, -98.7, 29.65, -98.35],
  'Las Vegas': [36.0, -115.35, 36.3, -115.0],
  Orlando: [28.35, -81.52, 28.65, -81.2],
  Miami: [25.7, -80.45, 25.9, -80.12],
  Jacksonville: [30.15, -81.85, 30.45, -81.45],
  Columbus: [39.85, -83.15, 40.1, -82.85],
  Indianapolis: [39.65, -86.33, 39.93, -85.95],
  'Kansas City': [38.9, -94.72, 39.2, -94.4],
  Raleigh: [35.7, -78.78, 35.95, -78.52],
  'Salt Lake City': [40.62, -112.05, 40.82, -111.8],
  Sacramento: [38.45, -121.56, 38.7, -121.36],
  'San Diego': [32.65, -117.25, 32.95, -117.05],
  Chicago: [41.75, -87.8, 42.0, -87.58],
  Seattle: [47.5, -122.43, 47.73, -122.25],
  Minneapolis: [44.88, -93.33, 45.05, -93.19],
  'St. Louis': [38.53, -90.32, 38.77, -90.17],
  Portland: [45.43, -122.75, 45.6, -122.5],
};

// niche -> OSM tag filters, and roughly what one new client is worth to them (USD), which sets value
export const NICHES = {
  dentist: { tags: ['["amenity"="dentist"]', '["healthcare"="dentist"]'], ticket: 3000 },
  law: { tags: ['["office"="lawyer"]'], ticket: 5000 },
  roofing: { tags: ['["craft"="roofer"]'], ticket: 9000 },
  hvac: { tags: ['["craft"="hvac"]', '["craft"="plumber"]'], ticket: 4000 },
  realestate: { tags: ['["office"="estate_agent"]'], ticket: 8000 },
  medspa: { tags: ['["shop"="beauty"]["beauty"~"spa|skin|laser|aesthetic"]', '["leisure"="spa"]'], ticket: 2500 },
  chiro: { tags: ['["healthcare"="chiropractor"]', '["healthcare:speciality"="chiropractic"]'], ticket: 2000 },
};

export async function discover(city, niche) {
  const [s, w, n, e] = CITIES[city];
  const parts = NICHES[niche].tags.map((t) => `nwr${t}["website"](${s},${w},${n},${e});`).join('\n');
  const q = `[out:json][timeout:60];(${parts});out tags center 200;`;
  // the public server is often busy (502/429/504): try a mirror, then wait and try again
  let r;
  for (const [i, url] of ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', OVERPASS, 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'].entries()) {
    if (i) await new Promise((ok) => setTimeout(ok, 8000 * i));
    r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': `job-pipeline-leads/0.1 (${process.env.MAIL_USER || 'see README'})` }, signal: AbortSignal.timeout(90000) }).catch(() => null);
    if (r?.ok) break;
  }
  if (!r?.ok) throw new Error(`overpass ${r?.status || 'unreachable'}`);
  const { elements } = await r.json();
  return elements
    .filter((el) => el.tags?.name && el.tags?.website)
    .map((el) => ({
      id: `osm:${el.type}/${el.id}`,
      name: el.tags.name,
      niche,
      city,
      website: el.tags.website.startsWith('http') ? el.tags.website : `http://${el.tags.website}`,
      phone: el.tags.phone || el.tags['contact:phone'] || null,
      email: el.tags.email || el.tags['contact:email'] || null,
      brand: el.tags.brand || null, // a chain: corporate site, not a lead
      address: [el.tags['addr:housenumber'], el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(' ') || null,
      source: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    }));
}
