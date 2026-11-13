/**
 * Downloads street-level photos of Bacalar from Mapillary (CC BY-SA 4.0) for building facades.
 *
 *   MAPILLARY_TOKEN=MLY|... npm run fetch-facades
 *   MAPILLARY_TOKEN=MLY|... npm run fetch-facades -- --max 2000
 *
 * Get a free token: mapillary.com > Dashboard > Developers > Register application, then copy
 * the "Client Token". Writes public/data/facades.json and public/facades/<id>.jpg.
 * The game only reads those files; it never calls Mapillary at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { makeProjection } from '../src/data/projection.ts';
import type { MapData } from '../src/data/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = resolve(ROOT, 'public/data/bacalar.json');
const OUT_JSON = resolve(ROOT, 'public/data/facades.json');
const OUT_DIR = resolve(ROOT, 'public/facades');
const TOKEN = process.env.MAPILLARY_TOKEN ?? '';
const maxArg = process.argv.indexOf('--max');
const MAX = maxArg > 0 ? parseInt(process.argv[maxArg + 1], 10) : 1200;

if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());

interface MlyImage {
  id: string;
  is_pano?: boolean;
  thumb_256_url?: string;
  compass_angle?: number;
  computed_compass_angle?: number;
  geometry?: { coordinates: [number, number] };
  computed_geometry?: { coordinates: [number, number] };
  creator?: { username?: string };
}

async function getJson(url: string): Promise<{ data: MlyImage[] }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `OAuth ${TOKEN}` } });
      if (res.status === 401 || res.status === 403) throw new Error(`Mapillary rejected the token (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { data: MlyImage[] };
    } catch (err) {
      if (attempt >= 4 || /token/.test((err as Error).message)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('Set MAPILLARY_TOKEN to your Mapillary client token (mapillary.com > Dashboard > Developers).');
    process.exit(1);
  }
  if (!existsSync(MAP)) throw new Error('Run "npm run fetch-map" first');
  const map = JSON.parse(readFileSync(MAP, 'utf8')) as MapData;
  const proj = makeProjection(map.meta.origin.lat, map.meta.origin.lon);

  // Only look where there are town streets: collect 0.01 degree cells touched by them.
  const cells = new Set<string>();
  for (const r of map.roads) {
    if (!/^(residential|secondary|primary|service)$/.test(r.cls)) continue;
    for (let i = 0; i < r.pts.length; i += 2) {
      const [lat, lon] = proj.toLatLon(r.pts[i], r.pts[i + 1]);
      cells.add(`${Math.floor(lon * 100)},${Math.floor(lat * 100)}`);
    }
  }
  console.log(`Querying ${cells.size} map cells…`);

  const found: { id: string; x: number; y: number; h: number; url: string; user: string }[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const c of cells) {
    const [i, j] = c.split(',').map(Number);
    const bbox = [i / 100, j / 100, (i + 1) / 100, (j + 1) / 100].join(',');
    const url = `https://graph.mapillary.com/images?fields=id,is_pano,thumb_256_url,compass_angle,computed_compass_angle,geometry,computed_geometry,creator&bbox=${bbox}&limit=2000`;
    const { data } = await getJson(url);
    for (const im of data) {
      if (im.is_pano || !im.thumb_256_url || seen.has(im.id)) continue;
      const g = im.computed_geometry ?? im.geometry;
      const h = im.computed_compass_angle ?? im.compass_angle;
      if (!g || h === undefined) continue;
      seen.add(im.id);
      const [x, y] = proj.toLocal(g.coordinates[1], g.coordinates[0]);
      const b = map.meta.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      found.push({ id: im.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, h: Math.round(h), url: im.thumb_256_url, user: im.creator?.username ?? '' });
    }
    process.stdout.write(`\r  cell ${++n}/${cells.size}, ${found.length} photos`);
  }
  console.log();
  if (!found.length) { console.log('No Mapillary photos in this area.'); return; }

  // Thin out: one photo per 10 m cell and 90 degree heading sector.
  const kept = new Map<string, (typeof found)[number]>();
  for (const p of found) {
    const k = `${Math.floor(p.x / 10)},${Math.floor(p.y / 10)},${Math.floor(((p.h + 45) % 360) / 90)}`;
    if (!kept.has(k)) kept.set(k, p);
  }
  let list = [...kept.values()];
  if (list.length > MAX) {
    // prefer the town center (closest to the origin, the Fuerte)
    list.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    list = list.slice(0, MAX);
  }
  console.log(`Keeping ${list.length} of ${found.length} photos, downloading thumbnails…`);

  mkdirSync(OUT_DIR, { recursive: true });
  const ok: typeof list = [];
  let done = 0, bytes = 0;
  const queue = list.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let p = queue.pop(); p; p = queue.pop()) {
      const file = resolve(OUT_DIR, `${p.id}.jpg`);
      try {
        if (!existsSync(file)) {
          const res = await fetch(p.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(file, buf);
          bytes += buf.length;
        }
        ok.push(p);
      } catch { /* skip photos that fail to download */ }
      process.stdout.write(`\r  ${++done}/${list.length}`);
    }
  }));
  console.log();

  const users = [...new Set(ok.map((p) => p.user).filter(Boolean))];
  writeFileSync(OUT_JSON, JSON.stringify({
    attribution: 'Street photos © Mapillary contributors, CC BY-SA',
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    contributors: users,
    generated: new Date().toISOString(),
    photos: ok.map(({ id, x, y, h }) => ({ id, x, y, h })),
  }));
  console.log(`Wrote ${OUT_JSON} with ${ok.length} photos from ${users.length} contributors (${(bytes / 1e6).toFixed(1)} MB downloaded).`);
}

main().catch((err) => { console.error(`\n${(err as Error).message}`); process.exit(1); });
