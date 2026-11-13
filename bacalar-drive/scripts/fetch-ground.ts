/**
 * Downloads a Sentinel-2 cloudless mosaic of the map area as public/data/ground.jpg.
 * Source: "Sentinel-2 cloudless 2016" by EOX IT Services GmbH (https://s2maps.eu), contains
 * modified Copernicus Sentinel data 2016, licensed CC BY 4.0 (commercial use allowed with
 * attribution). Later yearly mosaics are CC BY-NC-SA and must not be used here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import type { MapData } from '../src/data/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());

async function main() {
  const map = JSON.parse(readFileSync(resolve(ROOT, 'public/data/bacalar.json'), 'utf8')) as MapData;
  const [S, W, N, E] = map.meta.bbox;
  const url = 'https://tiles.maps.eox.at/wms?service=WMS&version=1.1.1&request=GetMap&layers=s2cloudless&styles='
    + `&srs=EPSG:4326&bbox=${W},${S},${E},${N}&width=1024&height=1024&format=image/jpeg`;
  const res = await fetch(url, { headers: { 'User-Agent': 'bacalar-drive-map-fetch/0.1' } });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('image')) throw new Error(`WMS request failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(ROOT, 'public/data/ground.jpg'), buf);
  console.log(`Wrote public/data/ground.jpg (${(buf.length / 1024).toFixed(0)} KB)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
