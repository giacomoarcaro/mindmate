import type { MapData, Ring } from '../data/types';

/**
 * Raster fields over the whole map at CELL meter resolution:
 *  - signed distance to the lagoon shore (positive on land, negative in water)
 *  - water kind (0 land, 1 water, 2 cenote)
 *  - land use (forest / residential / park)
 *  - occupancy (roads, buildings) used to keep trees off them
 * The terrain height function is derived from the shore distance.
 */

export const CELL = 5;
export const LAND_HEIGHT = 15;
export const SHORE_HEIGHT = 0.35;

export const LU_NONE = 0;
export const LU_FOREST = 1;
export const LU_RESIDENTIAL = 2;
export const LU_PARK = 3;

export interface HeightModifier {
  /** Returns the modified terrain height at a point given the height so far. */
  apply(x: number, y: number, h: number): number;
  minX: number; minY: number; maxX: number; maxY: number;
}

export class Field {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly nx: number;
  readonly ny: number;
  readonly sd: Float32Array;
  readonly water: Uint8Array;
  readonly landuse: Uint8Array;
  readonly occupied: Uint8Array;
  modifiers: HeightModifier[] = [];
  /** Sentinel-2 image of the map area (RGBA pixels, north up), if loaded */
  ground: { data: Uint8ClampedArray; w: number; h: number } | null = null;

  /** Satellite color at a map point as linear RGB 0..1, or null without imagery. */
  groundColor(x: number, y: number, out: [number, number, number]): boolean {
    const g = this.ground;
    if (!g) return false;
    const u = (x - this.minX) / (this.maxX - this.minX), v = 1 - (y - this.minY) / (this.maxY - this.minY);
    const fx = Math.max(0, Math.min(g.w - 1.001, u * (g.w - 1))), fy = Math.max(0, Math.min(g.h - 1.001, v * (g.h - 1)));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    for (let c = 0; c < 3; c++) {
      const a = g.data[(j * g.w + i) * 4 + c], b = g.data[(j * g.w + i + 1) * 4 + c];
      const d = g.data[((j + 1) * g.w + i) * 4 + c], e = g.data[((j + 1) * g.w + i + 1) * 4 + c];
      const s = ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty) / 255;
      out[c] = Math.pow(s, 2.2); // sRGB to linear
    }
    return true;
  }

  constructor(data: MapData) {
    const b = data.meta.bounds;
    this.minX = b.minX; this.minY = b.minY; this.maxX = b.maxX; this.maxY = b.maxY;
    this.nx = Math.ceil((b.maxX - b.minX) / CELL) + 1;
    this.ny = Math.ceil((b.maxY - b.minY) / CELL) + 1;
    const n = this.nx * this.ny;
    this.water = new Uint8Array(n);
    this.landuse = new Uint8Array(n);
    this.occupied = new Uint8Array(n);
    this.sd = new Float32Array(n);

    for (const w of data.water) this.fillPolygon(w.rings, this.water, w.kind === 'cenote' ? 2 : 1);
    for (const a of data.forest) this.fillPolygon(a.rings, this.landuse, LU_FOREST);
    for (const a of data.residential) this.fillPolygon(a.rings, this.landuse, LU_RESIDENTIAL);
    for (const a of data.parks) this.fillPolygon(a.rings, this.landuse, LU_PARK);
    this.computeSignedDistance();
  }

  // -------------------------------------------------------------------------
  // Rasterization

  /** Even-odd scanline fill of a polygon with holes. */
  fillPolygon(rings: Ring[], grid: Uint8Array, value: number) {
    let minY = Infinity, maxY = -Infinity;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) { minY = Math.min(minY, r[i]); maxY = Math.max(maxY, r[i]); }
    const j0 = Math.max(0, Math.floor((minY - this.minY) / CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil((maxY - this.minY) / CELL));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const y = this.minY + j * CELL;
      xs.length = 0;
      for (const r of rings) {
        const m = r.length / 2;
        for (let k = 0; k < m; k++) {
          const ax = r[2 * k], ay = r[2 * k + 1];
          const k2 = (k + 1) % m;
          const bx = r[2 * k2], by = r[2 * k2 + 1];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.minX) / CELL));
        const i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1] - this.minX) / CELL));
        for (let i = i0; i <= i1; i++) grid[j * this.nx + i] = value;
      }
    }
  }

  /** Marks cells within `radius` of the segment as occupied. */
  markSegment(ax: number, ay: number, bx: number, by: number, radius: number, value = 1) {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - this.minX) / CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil((Math.max(ax, bx) + radius - this.minX) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - radius - this.minY) / CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil((Math.max(ay, by) + radius - this.minY) / CELL));
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const r2 = radius * radius;
    for (let j = j0; j <= j1; j++) {
      const y = this.minY + j * CELL;
      for (let i = i0; i <= i1; i++) {
        const x = this.minX + i * CELL;
        let t = ((x - ax) * dx + (y - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= r2) this.occupied[j * this.nx + i] = value;
      }
    }
  }

  markPolygon(ring: Ring, pad: number) {
    const m = ring.length / 2;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      this.markSegment(ring[2 * k], ring[2 * k + 1], ring[2 * k2], ring[2 * k2 + 1], pad);
    }
    this.fillPolygon([ring], this.occupied, 1);
  }

  // -------------------------------------------------------------------------
  // Distance transform (Felzenszwalb & Huttenlocher, exact squared EDT)

  private computeSignedDistance() {
    const { nx, ny } = this;
    const INF = 1e20;
    const toWater = new Float64Array(nx * ny);
    const toLand = new Float64Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) {
      const isW = this.water[k] > 0;
      toWater[k] = isW ? 0 : INF;
      toLand[k] = isW ? INF : 0;
    }
    edt2d(toWater, nx, ny);
    edt2d(toLand, nx, ny);
    for (let k = 0; k < nx * ny; k++) {
      this.sd[k] = this.water[k] > 0
        ? -(Math.sqrt(toLand[k]) - 0.5) * CELL
        : (Math.sqrt(toWater[k]) - 0.5) * CELL;
    }
  }

  // -------------------------------------------------------------------------
  // Sampling

  private bilinear(grid: Float32Array, x: number, y: number): number {
    let fx = (x - this.minX) / CELL, fy = (y - this.minY) / CELL;
    fx = Math.max(0, Math.min(this.nx - 1.001, fx));
    fy = Math.max(0, Math.min(this.ny - 1.001, fy));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = j * this.nx + i;
    const a = grid[k], b = grid[k + 1], c = grid[k + this.nx], d = grid[k + this.nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  cellIndex(x: number, y: number): number {
    const i = Math.round((x - this.minX) / CELL), j = Math.round((y - this.minY) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  /** Signed distance to shore in meters (+ land, - water). */
  shoreDist(x: number, y: number): number {
    return this.bilinear(this.sd, x, y);
  }

  waterKind(x: number, y: number): number {
    const k = this.cellIndex(x, y);
    return k < 0 ? 0 : this.water[k];
  }

  landuseAt(x: number, y: number): number {
    const k = this.cellIndex(x, y);
    return k < 0 ? 0 : this.landuse[k];
  }

  isOccupied(x: number, y: number): boolean {
    const k = this.cellIndex(x, y);
    return k < 0 ? true : this.occupied[k] > 0;
  }

  /** Natural terrain height before landmark modifiers. */
  baseHeight(x: number, y: number): number {
    const d = this.shoreDist(x, y);
    if (d >= 0) return SHORE_HEIGHT + (LAND_HEIGHT - SHORE_HEIGHT) * (1 - Math.exp(-d / 45));
    const cenote = this.waterKind(x, y) === 2;
    if (cenote) return SHORE_HEIGHT - 45 * (1 - Math.exp(d / 10));
    return SHORE_HEIGHT - 9 * (1 - Math.exp(d / 30));
  }

  heightAt(x: number, y: number): number {
    let h = this.baseHeight(x, y);
    for (const m of this.modifiers) {
      if (x < m.minX || x > m.maxX || y < m.minY || y > m.maxY) continue;
      h = m.apply(x, y, h);
    }
    return h;
  }

  inBounds(x: number, y: number, margin = 0): boolean {
    return x >= this.minX + margin && x <= this.maxX - margin && y >= this.minY + margin && y <= this.maxY - margin;
  }
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function edt2d(grid: Float64Array, nx: number, ny: number) {
  const n = Math.max(nx, ny);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = grid[j * nx + i];
    edt1d(f, ny, d, v, z);
    for (let j = 0; j < ny; j++) grid[j * nx + i] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) f[i] = grid[row + i];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) grid[row + i] = d[i];
  }
}
