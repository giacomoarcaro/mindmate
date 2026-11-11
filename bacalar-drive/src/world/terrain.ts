import * as THREE from 'three';
import { Field, LU_FOREST, LU_PARK, LU_RESIDENTIAL } from './field';
import { TILE } from './tilegrid';

const C_SAND = new THREE.Color('#e9e3cf');
const C_BOTTOM = new THREE.Color('#e4ede4');
const C_DEEP = new THREE.Color('#5a7f86');
const C_GRASS = new THREE.Color('#6a8a3a');
const C_JUNGLE = new THREE.Color('#3e5f27');
const C_TOWN = new THREE.Color('#a49a72');
const C_PARK = new THREE.Color('#78a443');

function hash2(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

const tmp = new THREE.Color();

export function terrainColor(field: Field, x: number, y: number, h: number, out: THREE.Color) {
  const d = field.shoreDist(x, y);
  const n = vnoise(x / 23, y / 23) * 0.6 + vnoise(x / 6, y / 6) * 0.4;
  if (d < 0) {
    // lagoon bed: white limestone that darkens with depth
    const t = Math.min(1, -h / 9);
    out.copy(C_BOTTOM).lerp(C_DEEP, t * t);
    return out;
  }
  const lu = field.landuseAt(x, y);
  if (lu === LU_FOREST) out.copy(C_JUNGLE);
  else if (lu === LU_RESIDENTIAL) out.copy(C_TOWN).lerp(C_GRASS, n * 0.6);
  else if (lu === LU_PARK) out.copy(C_PARK);
  else out.copy(C_GRASS).lerp(C_JUNGLE, Math.min(1, d / 400) * 0.7);
  out.multiplyScalar(0.82 + n * 0.32);
  if (d < 10) out.lerp(C_SAND, 1 - d / 10);
  return out;
}

export interface TerrainTileData {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  indices: Uint32Array;
}

/** Height grid mesh for one 250 m tile. */
export function buildTerrainTile(field: Field, ox: number, oy: number, step = 5): TerrainTileData {
  const n = Math.round(TILE / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ox + i * step, y = oy + j * step;
      const h = field.heightAt(x, y);
      const k = (j * n + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = -y;
      terrainColor(field, x, y, h, tmp);
      col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // world z = -y, so rows go "north" = -z; keep CCW seen from above
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, positions: pos, indices: idx };
}

/** Coarse terrain for the whole map, drawn slightly lower so loaded tiles cover it. */
export function buildFarTerrain(field: Field, step = 50, margin = 3000): THREE.BufferGeometry {
  const minX = field.minX - margin, minY = field.minY - margin;
  const nx = Math.ceil((field.maxX - field.minX + 2 * margin) / step) + 1;
  const ny = Math.ceil((field.maxY - field.minY + 2 * margin) / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const col = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * step, y = minY + j * step;
    // outside the data area, continue the land so the horizon is jungle
    const inside = field.inBounds(x, y);
    const h = inside ? field.heightAt(x, y) : field.heightAt(x, y) > 0 ? 15 : field.heightAt(x, y);
    const k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = h - 1.2; pos[k + 2] = -y;
    terrainColor(field, x, y, h, tmp);
    if (h > 1) tmp.lerp(C_JUNGLE, 0.6);
    col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = b; idx[p++] = c;
    idx[p++] = b; idx[p++] = d; idx[p++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}
