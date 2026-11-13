/**
 * Adds real building footprints to public/data/bacalar.json from Microsoft's Global ML
 * Building Footprints (derived from satellite imagery, ODbL). OpenStreetMap has only a few
 * dozen buildings in Bacalar; this dataset has the rest of the town.
 *
 *   npm run fetch-buildings          (also run by npm run fetch-map)
 *
 * Downloads only the 1-5 MB tiles that cover the map; the game never calls it at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeProjection } from '../src/data/projection.ts';
import type { Building, MapData } from '../src/data/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = resolve(ROOT, 'public/data/bacalar.json');
const CACHE = resolve(ROOT, 'scripts/.cache/ms-buildings');
const INDEX = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';

if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());

/** Bing maps quadkey of the tile containing a point. */
function quadkey(lat: number, lon: number, zoom = 9) {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const tx = Math.floor(x * 2 ** zoom), ty = Math.floor(y * 2 ** zoom);
  let k = '';
  for (let i = zoom; i > 0; i--) {
    const m = 1 << (i - 1);
    k += String((tx & m ? 1 : 0) + (ty & m ? 2 : 0));
  }
  return k;
}

async function download(url: string, file: string) {
  if (existsSync(file)) return readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function pointInRing(r: number[], x: number, y: number) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function main() {
  if (!existsSync(MAP)) throw new Error('Run "npm run fetch-map" first');
  const map = JSON.parse(readFileSync(MAP, 'utf8')) as MapData;
  const [S, W, N, E] = map.meta.bbox;
  const proj = makeProjection(map.meta.origin.lat, map.meta.origin.lon);
  mkdirSync(CACHE, { recursive: true });

  const keys = new Set<string>();
  for (let lat = S; lat <= N + 0.05; lat += 0.05) for (let lon = W; lon <= E + 0.05; lon += 0.05) keys.add(quadkey(Math.min(lat, N), Math.min(lon, E)));
  console.log('Quadkeys:', [...keys].join(', '));

  const index = (await download(INDEX, resolve(CACHE, 'dataset-links.csv'))).toString('utf8');
  const rows = index.split('\n').map((l) => l.split(',')).filter((r) => r[0] === 'Mexico' && keys.has(r[1]));
  if (!rows.length) throw new Error('No Microsoft building tiles for this area');

  const osm = map.buildings.filter((b) => b.source !== 'ms');
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const out: Building[] = [];
  let id = -1;
  for (const [, qk, url] of rows) {
    console.log(`Downloading tile ${qk}…`);
    const text = gunzipSync(await download(url, resolve(CACHE, `${qk}.csv.gz`))).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const f = JSON.parse(line) as { properties: { height?: number }; geometry: { coordinates: number[][][] } };
      const ring = f.geometry.coordinates[0];
      let lat = 0, lon = 0;
      for (const [x, y] of ring) { lon += x; lat += y; }
      lat /= ring.length; lon /= ring.length;
      if (lat < S || lat > N || lon < W || lon > E) continue;
      const pts: number[] = [];
      for (const [x, y] of ring.slice(0, -1)) { const [px, py] = proj.toLocal(y, x); pts.push(r1(px), r1(py)); }
      if (pts.length < 6) continue;
      const [cx, cy] = proj.toLocal(lat, lon);
      // OSM wins where both datasets have the same building
      if (osm.some((b) => pointInRing(b.rings[0], cx, cy))) continue;
      const h = f.properties.height;
      out.push({ id: id--, rings: [pts], height: h && h > 0 ? r1(h) : undefined, source: 'ms' });
    }
  }
  map.buildings = [...osm, ...out];
  map.meta.attribution = 'Map data © OpenStreetMap contributors (ODbL) · Building footprints © Microsoft (ODbL)';
  writeFileSync(MAP, JSON.stringify(map));
  console.log(`Added ${out.length} Microsoft footprints (${osm.length} from OSM kept). ${MAP}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
