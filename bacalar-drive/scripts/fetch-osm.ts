/**
 * Downloads OpenStreetMap data for Bacalar from the Overpass API (one query),
 * projects it to local meters and writes public/data/bacalar.json.
 *
 *   npm run fetch-map             fetch from Overpass, then process
 *   npm run fetch-map -- --offline  reprocess the cached raw response
 *
 * The game never calls Overpass at runtime; it only reads the JSON written here.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeProjection } from '../src/data/projection.ts';
import type {
  MapData, Road, Building, AreaFeature, WaterBody, Pier, Poi, Ring,
} from '../src/data/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/bacalar.json');
const CACHE = resolve(ROOT, 'scripts/.cache/overpass-raw.json');
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

// Only the center of Bacalar: a square of RADIUS_M around the main plaza (BACALAR letters).
const CENTER = { lat: 18.67698, lon: -88.38968 };
const RADIUS_M = 4000;
const dLat = RADIUS_M / 110574, dLon = RADIUS_M / (111320 * Math.cos((CENTER.lat * Math.PI) / 180));
// south, west, north, east
let BBOX: [number, number, number, number] = [
  +(CENTER.lat - dLat).toFixed(5), +(CENTER.lon - dLon).toFixed(5), +(CENTER.lat + dLat).toFixed(5), +(CENTER.lon + dLon).toFixed(5),
];

// Fuerte de San Felipe, used as projection origin (refined from data when found)
const FORT_FALLBACK = { lat: 18.67696, lon: -88.38853 };

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

// ---------------------------------------------------------------------------
// Overpass

interface OsmTags { [k: string]: string }
interface LatLon { lat: number; lon: number }
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: OsmTags }
interface OsmWay { type: 'way'; id: number; geometry?: LatLon[]; tags?: OsmTags }
interface OsmMember { type: string; ref: number; role: string; geometry?: LatLon[] }
interface OsmRel { type: 'relation'; id: number; members?: OsmMember[]; tags?: OsmTags }
type OsmEl = OsmNode | OsmWay | OsmRel;

function buildQuery(b: typeof BBOX): string {
  const bb = b.join(',');
  return `[out:json][timeout:300][bbox:${bb}];
(
  way[highway];
  way[building]; relation[building];
  way[natural=water]; relation[natural=water];
  way[natural=wood]; relation[natural=wood];
  way[landuse=forest]; relation[landuse=forest];
  way[landuse=residential]; relation[landuse=residential];
  way[leisure=park]; relation[leisure=park];
  way[man_made=pier]; relation[man_made=pier];
  node[amenity][name]; way[amenity][name];
  node[tourism][name]; way[tourism][name];
  node[historic][name]; way[historic][name];
  node[place][name];
);
out geom;`;
}

async function fetchOverpass(b: typeof BBOX): Promise<OsmEl[]> {
  const body = new URLSearchParams({ data: buildQuery(b) });
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`Overpass request (attempt ${attempt}) bbox=${b.join(',')}`);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body,
        headers: {
          // overpass-api.de rejects requests without a descriptive User-Agent (HTTP 406)
          'User-Agent': 'bacalar-drive-map-fetch/0.1 (one-off data export for a browser game)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
      const json = (await res.json()) as { elements: OsmEl[] };
      return json.elements;
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('Overpass request failed after retries');
}

// ---------------------------------------------------------------------------
// Coverage check

function coverage(els: OsmEl[]) {
  const name = (e: OsmEl) => (e.tags?.name ?? '').toLowerCase();
  return {
    town: els.some((e) => e.type === 'node' && e.tags?.place && name(e) === 'bacalar'),
    fort: els.some((e) => /san felipe|fuerte/.test(name(e)) && (e.tags?.historic || e.tags?.tourism)),
    cenoteAzul: els.some((e) => /cenote azul/.test(name(e))),
    costera: els.some((e) => e.type === 'way' && e.tags?.highway && /costera/.test(name(e))),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers

function ringsFromRelation(rel: OsmRel): { outer: LatLon[][]; inner: LatLon[][] } {
  const outer: LatLon[][] = [];
  const inner: LatLon[][] = [];
  const segs: Record<'outer' | 'inner', LatLon[][]> = { outer: [], inner: [] };
  for (const m of rel.members ?? []) {
    if (m.type !== 'way' || !m.geometry || m.geometry.length < 2) continue;
    const role = m.role === 'inner' ? 'inner' : 'outer';
    segs[role].push(m.geometry.slice());
  }
  for (const role of ['outer', 'inner'] as const) {
    const out = role === 'outer' ? outer : inner;
    const pool = segs[role];
    const same = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
    while (pool.length) {
      let ring = pool.pop()!;
      let progress = true;
      while (!same(ring[0], ring[ring.length - 1]) && progress) {
        progress = false;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          const end = ring[ring.length - 1];
          if (same(end, s[0])) ring = ring.concat(s.slice(1));
          else if (same(end, s[s.length - 1])) ring = ring.concat(s.slice(0, -1).reverse());
          else if (same(ring[0], s[s.length - 1])) ring = s.concat(ring.slice(1));
          else if (same(ring[0], s[0])) ring = s.slice().reverse().concat(ring.slice(1));
          else continue;
          pool.splice(i, 1);
          progress = true;
          break;
        }
      }
      if (ring.length >= 4) out.push(ring);
    }
  }
  return { outer, inner };
}

/** Sutherland-Hodgman clip of a closed ring to an axis aligned rectangle. */
function clipRing(ring: Ring, minX: number, minY: number, maxX: number, maxY: number): Ring {
  let pts: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= minX, (a, b) => { const t = (minX - a[0]) / (b[0] - a[0]); return [minX, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= maxX, (a, b) => { const t = (maxX - a[0]) / (b[0] - a[0]); return [maxX, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= minY, (a, b) => { const t = (minY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), minY]; }],
    [(p) => p[1] <= maxY, (a, b) => { const t = (maxY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), maxY]; }],
  ];
  for (const [inside, inter] of edges) {
    const input = pts;
    pts = [];
    if (!input.length) break;
    let prev = input[input.length - 1];
    for (const cur of input) {
      if (inside(cur)) {
        if (!inside(prev)) pts.push(inter(prev, cur));
        pts.push(cur);
      } else if (inside(prev)) pts.push(inter(prev, cur));
      prev = cur;
    }
  }
  return pts.flat();
}

// ---------------------------------------------------------------------------
// Classification

const ROAD_WIDTH: Record<string, number> = {
  motorway: 11, trunk: 10, primary: 9, secondary: 7, tertiary: 6,
  motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 5, tertiary_link: 5,
  residential: 5, unclassified: 5, living_street: 4.5, service: 3.5,
  track: 3, path: 1.6, footway: 1.8, cycleway: 2, pedestrian: 4, steps: 1.6, bridleway: 1.6,
};
const UNPAVED = /unpaved|dirt|ground|gravel|compacted|sand|earth|grass|fine_gravel|mud|rock/;

function roadClass(hw: string): string {
  if (/^(motorway|trunk|primary)(_link)?$/.test(hw)) return 'primary';
  if (/^secondary(_link)?$/.test(hw)) return 'secondary';
  if (/^tertiary(_link)?$/.test(hw)) return 'secondary';
  if (/^(residential|unclassified|living_street)$/.test(hw)) return 'residential';
  if (hw === 'service') return 'service';
  if (hw === 'track') return 'track';
  if (/^(footway|path|cycleway|pedestrian|steps|bridleway)$/.test(hw)) return 'path';
  return 'residential';
}

// ---------------------------------------------------------------------------

async function main() {
  const offline = process.argv.includes('--offline');
  let els: OsmEl[];

  if (offline) {
    if (!existsSync(CACHE)) throw new Error(`No cache at ${CACHE}; run without --offline first`);
    const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
    els = cached.elements; // may cover a larger area; everything is cut to BBOX below
  } else {
    for (let tries = 0; ; tries++) {
      els = await fetchOverpass(BBOX);
      const cov = coverage(els);
      console.log('Coverage check:', cov);
      if (Object.values(cov).every(Boolean) || tries >= 2) break;
      BBOX = [BBOX[0] - 0.02, BBOX[1] - 0.02, BBOX[2] + 0.02, BBOX[3] + 0.02];
      console.log('Some landmarks missing, widening bbox to', BBOX.join(','));
    }
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ bbox: BBOX, elements: els }));
  }

  // Projection origin: centroid of the Fuerte de San Felipe outline
  let origin = FORT_FALLBACK;
  const fortWay = els.find((e): e is OsmWay => e.type === 'way' && !!e.geometry && /san felipe/i.test(e.tags?.name ?? ''));
  if (fortWay?.geometry) {
    const g = fortWay.geometry;
    origin = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
  }
  const proj = makeProjection(origin.lat, origin.lon);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const toFlat = (g: LatLon[]): number[] => {
    const out: number[] = [];
    for (const p of g) { const [x, y] = proj.toLocal(p.lat, p.lon); out.push(r1(x), r1(y)); }
    return out;
  };
  const openRing = (r: number[]) => {
    const n = r.length;
    if (n >= 4 && r[0] === r[n - 2] && r[1] === r[n - 1]) return r.slice(0, n - 2);
    return r;
  };
  const [minX, minY] = proj.toLocal(BBOX[0], BBOX[1]);
  const [maxX, maxY] = proj.toLocal(BBOX[2], BBOX[3]);
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  /** Cuts a polyline into the pieces that lie inside the map. */
  const clipLine = (pts: number[]): number[][] => {
    const out: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      if (inside(pts[i], pts[i + 1])) cur.push(pts[i], pts[i + 1]);
      else { if (cur.length >= 4) out.push(cur); cur = []; }
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  };
  const centerOf = (r: number[]): [number, number] => {
    let x = 0, y = 0;
    for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; }
    return [x / (r.length / 2), y / (r.length / 2)];
  };
  const clip = (r: Ring) => clipRing(r, minX - 20, minY - 20, maxX + 20, maxY + 20).map(r1);

  const polygonsOf = (e: OsmEl): Ring[][] => {
    if (e.type === 'way' && e.geometry && e.geometry.length >= 4) {
      return [[openRing(toFlat(e.geometry))]];
    }
    if (e.type === 'relation') {
      const { outer, inner } = ringsFromRelation(e);
      const inners = inner.map((r) => openRing(toFlat(r)));
      // Each outer ring becomes its own polygon; holes are assigned to every outer
      // (the renderer handles holes by point-in-polygon tests, so this is safe).
      return outer.map((o) => [openRing(toFlat(o)), ...inners]);
    }
    return [];
  };

  const roads: Road[] = [];
  const buildings: Building[] = [];
  const water: WaterBody[] = [];
  const forest: AreaFeature[] = [];
  const residential: AreaFeature[] = [];
  const parks: AreaFeature[] = [];
  const piers: Pier[] = [];
  const pois: Poi[] = [];
  const landmarks: Poi[] = [];

  for (const e of els) {
    const t = e.tags ?? {};
    if (e.type === 'way' && t.highway && e.geometry) {
      if (t.area === 'yes') continue;
      const hw = t.highway;
      if (/^(proposed|construction|platform|bus_stop|elevator|corridor|raceway|abandoned|razed)$/.test(hw)) continue;
      const cls = roadClass(hw);
      let width = ROAD_WIDTH[hw] ?? 5;
      if (t.width && !isNaN(parseFloat(t.width))) width = Math.min(14, Math.max(2, parseFloat(t.width)));
      if (t.lanes && /^(primary|secondary)$/.test(cls)) width = Math.max(width, parseInt(t.lanes, 10) * 3.4 || width);
      const surface = t.surface ?? (cls === 'track' ? 'unpaved' : 'paved');
      for (const piece of clipLine(toFlat(e.geometry))) roads.push({
        id: e.id,
        name: t.name ?? t.ref ?? '',
        hw,
        cls,
        width: r1(width),
        paved: !(cls === 'track' || UNPAVED.test(surface)),
        bridge: t.bridge === 'yes' || undefined,
        oneway: t.oneway === 'yes' || undefined,
        pts: piece,
      });
      continue;
    }
    if (t.building || t['building:part']) {
      const levels = parseFloat(t['building:levels'] ?? '');
      const height = parseFloat(t.height ?? '');
      for (const poly of polygonsOf(e)) {
        if (poly[0].length < 6 || !inside(...centerOf(poly[0]))) continue;
        buildings.push({
          id: e.id,
          rings: poly,
          levels: isNaN(levels) ? undefined : levels,
          height: isNaN(height) ? undefined : height,
          kind: t.building !== 'yes' ? t.building : undefined,
          name: t.name || undefined,
        });
      }
    }
    if (t.natural === 'water') {
      const nm = t.name ?? '';
      const isCenote = /cenote/i.test(nm) || t.water === 'cenote' || t.water === 'sinkhole';
      const isLagoon = t.water === 'lagoon' || t.water === 'lake' || /laguna/i.test(nm);
      for (const poly of polygonsOf(e)) {
        const rings = poly.map(clip).filter((r) => r.length >= 6);
        if (!rings.length) continue;
        water.push({ id: e.id, name: nm || undefined, kind: isCenote ? 'cenote' : isLagoon ? 'lagoon' : 'pond', rings });
      }
    }
    const area = (list: AreaFeature[]) => {
      for (const poly of polygonsOf(e)) {
        const rings = poly.map(clip).filter((r) => r.length >= 6);
        if (rings.length) list.push({ id: e.id, name: t.name || undefined, rings });
      }
    };
    if (t.natural === 'wood' || t.landuse === 'forest') area(forest);
    if (t.landuse === 'residential') area(residential);
    if (t.leisure === 'park') area(parks);
    if (t.man_made === 'pier') {
      if (e.type === 'way' && e.geometry) {
        const pts = toFlat(e.geometry);
        if (!inside(...centerOf(pts))) continue;
        const closed = e.geometry.length > 3 && e.geometry[0].lat === e.geometry[e.geometry.length - 1].lat && e.geometry[0].lon === e.geometry[e.geometry.length - 1].lon;
        piers.push({ id: e.id, name: t.name || undefined, area: closed || t.area === 'yes' || undefined, pts: closed ? openRing(pts) : pts, width: parseFloat(t.width ?? '') || 2.5 });
      }
    }
    if (t.name && (t.amenity || t.tourism || t.historic || t.place)) {
      let x: number, y: number;
      if (e.type === 'node') [x, y] = proj.toLocal(e.lat, e.lon);
      else if (e.type === 'way' && e.geometry) {
        const g = e.geometry;
        [x, y] = proj.toLocal(g.reduce((s, p) => s + p.lat, 0) / g.length, g.reduce((s, p) => s + p.lon, 0) / g.length);
      } else continue;
      const kind = t.historic ? `historic:${t.historic}` : t.tourism ? `tourism:${t.tourism}` : t.place ? `place:${t.place}` : `amenity:${t.amenity}`;
      if (!inside(x, y)) continue;
      const poi: Poi = { name: t.name, kind, x: r1(x), y: r1(y) };
      // keep outlines of historic sites (used to orient and size the fort model)
      if (t.historic && e.type === 'way' && e.geometry && e.geometry.length >= 4) poi.ring = openRing(toFlat(e.geometry));
      (t.historic || t.place ? landmarks : pois).push(poi);
    }
  }

  // Cenote Azul fallback: the lake polygon may be tagged without a name
  const data: MapData = {
    meta: {
      bbox: BBOX,
      origin,
      bounds: { minX: r1(minX), minY: r1(minY), maxX: r1(maxX), maxY: r1(maxY) },
      generated: new Date().toISOString(),
      attribution: 'Map data © OpenStreetMap contributors (ODbL)',
      note: 'Coordinates in meters, x east, y north, origin at Fuerte de San Felipe',
    },
    roads, buildings, water, forest, residential, parks, piers, pois, landmarks,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data));
  const kb = (JSON.stringify(data).length / 1024).toFixed(0);
  console.log(`Wrote ${OUT} (${kb} KB)`);
  console.log(`  roads ${roads.length}, buildings ${buildings.length}, water ${water.length}, forest ${forest.length},`
    + ` residential ${residential.length}, parks ${parks.length}, piers ${piers.length}, pois ${pois.length}, landmarks ${landmarks.length}`);
  console.log(`  extent ${(maxX - minX).toFixed(0)} m x ${(maxY - minY).toFixed(0)} m`);
}

main().catch((err) => { console.error(err); process.exit(1); });
