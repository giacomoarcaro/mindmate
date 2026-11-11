import type { MapData, Road } from '../data/types';
import type { Field } from './field';
import { TileGrid } from './tilegrid';

/** Road classes used for rendering. */
export type RoadMat = 'asphalt' | 'dirt' | 'concrete' | 'marking';

const LIFT: Record<string, number> = {
  primary: 0.16, secondary: 0.14, residential: 0.12, service: 0.1, track: 0.09, path: 0.08,
};

export interface RoadSeg {
  road: RoadInfo;
  ax: number; ay: number; bx: number; by: number;
}

export interface RoadInfo {
  src: Road;
  /** densified points, x,y pairs */
  pts: number[];
  /** road surface height at each densified point */
  hs: number[];
}

export interface NearestRoad {
  road: RoadInfo;
  dist: number;
  x: number; y: number;
  /** direction of the road at the nearest point (unit, map coords) */
  dx: number; dy: number;
  h: number;
}

/** Geometry buffers for one tile: flat arrays of xyz positions and uv per vertex. */
export interface TileRoadBuffers {
  pos: Record<RoadMat, number[]>;
  uv: Record<RoadMat, number[]>;
}

export class RoadNetwork {
  readonly roads: RoadInfo[] = [];
  readonly tiles = new Map<number, TileRoadBuffers>();
  private hash = new Map<number, RoadSeg[]>();
  private readonly H = 40;

  constructor(data: MapData, private field: Field, private grid: TileGrid) {
    for (const r of data.roads) {
      if (r.pts.length < 4) continue;
      const pts = densify(r.pts, 5);
      const lift = LIFT[r.cls] ?? 0.1;
      const hs: number[] = [];
      const hw = r.width / 2;
      for (let i = 0; i < pts.length; i += 2) {
        const [dx, dy] = dirAt(pts, i / 2);
        const x = pts[i], y = pts[i + 1];
        let h = Math.max(
          field.heightAt(x, y),
          field.heightAt(x - dy * hw, y + dx * hw),
          field.heightAt(x + dy * hw, y - dx * hw),
        ) + lift;
        if (r.bridge || field.shoreDist(x, y) < 0) h = Math.max(h, 1.6 + lift);
        hs.push(h);
      }
      const info: RoadInfo = { src: r, pts, hs };
      this.roads.push(info);
      for (let i = 0; i + 3 < pts.length; i += 2) {
        this.insertSeg({ road: info, ax: pts[i], ay: pts[i + 1], bx: pts[i + 2], by: pts[i + 3] });
        field.markSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], hw + 2.5);
      }
    }
    // Draw minor roads first so primary roads end up on top within a tile buffer.
    const order = ['path', 'track', 'service', 'residential', 'secondary', 'primary'];
    const sorted = this.roads.slice().sort((a, b) => order.indexOf(a.src.cls) - order.indexOf(b.src.cls));
    for (const r of sorted) this.buildRibbon(r);
  }

  // -------------------------------------------------------------------------

  private bufs(tile: number): TileRoadBuffers {
    let b = this.tiles.get(tile);
    if (!b) {
      b = {
        pos: { asphalt: [], dirt: [], concrete: [], marking: [] },
        uv: { asphalt: [], dirt: [], concrete: [], marking: [] },
      };
      this.tiles.set(tile, b);
    }
    return b;
  }

  private material(r: Road): RoadMat {
    if (r.cls === 'path') return r.paved ? 'concrete' : 'dirt';
    return r.paved ? 'asphalt' : 'dirt';
  }

  private buildRibbon(info: RoadInfo) {
    const { pts, hs, src } = info;
    const mat = this.material(src);
    const n = pts.length / 2;
    const w = src.width;
    const side = offsetLines(pts, w / 2);

    let dist = 0;
    for (let i = 0; i < n - 1; i++) {
      const segLen = Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
      const mx = (pts[2 * i] + pts[2 * i + 2]) / 2, my = (pts[2 * i + 1] + pts[2 * i + 3]) / 2;
      const b = this.bufs(this.grid.keyAt(mx, my));
      const v0 = dist / w, v1 = (dist + segLen) / w;
      quad(b.pos[mat], b.uv[mat],
        side.lx[i], side.ly[i], hs[i], side.rx[i], side.ry[i], hs[i],
        side.lx[i + 1], side.ly[i + 1], hs[i + 1], side.rx[i + 1], side.ry[i + 1], hs[i + 1],
        v0, v1);
      dist += segLen;
    }
    // Round end caps hide gaps at junctions.
    for (const e of [0, n - 1]) {
      const x = pts[2 * e], y = pts[2 * e + 1];
      const b = this.bufs(this.grid.keyAt(x, y));
      disc(b.pos[mat], b.uv[mat], x, y, hs[e] - 0.01, w / 2, 10);
    }

    if (src.cls === 'primary' && src.paved) this.buildMarkings(info);
  }

  private buildMarkings(info: RoadInfo) {
    const { pts, hs, src } = info;
    const n = pts.length / 2;
    const lineW = 0.15;
    const edge = src.width / 2 - 0.35;
    const lines: { off: number; dashed: boolean }[] = [
      { off: 0, dashed: true },
      { off: edge, dashed: false },
      { off: -edge, dashed: false },
    ];
    for (const L of lines) {
      const a = offsetLines(pts, lineW / 2, L.off);
      let dist = 0;
      const total = totalLength(pts);
      for (let i = 0; i < n - 1; i++) {
        const segLen = Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
        // skip the first and last few meters so markings do not cross junctions
        const nearEnd = dist < 8 || dist > total - 8;
        const dashOn = !L.dashed || (Math.floor(dist / 4.5) % 2 === 0);
        if (dashOn && !nearEnd) {
          const mx = (pts[2 * i] + pts[2 * i + 2]) / 2, my = (pts[2 * i + 1] + pts[2 * i + 3]) / 2;
          const b = this.bufs(this.grid.keyAt(mx, my));
          quad(b.pos.marking, b.uv.marking,
            a.lx[i], a.ly[i], hs[i] + 0.02, a.rx[i], a.ry[i], hs[i] + 0.02,
            a.lx[i + 1], a.ly[i + 1], hs[i + 1] + 0.02, a.rx[i + 1], a.ry[i + 1], hs[i + 1] + 0.02,
            0, 1);
        }
        dist += segLen;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Spatial queries

  private insertSeg(s: RoadSeg) {
    const H = this.H;
    const i0 = Math.floor(Math.min(s.ax, s.bx) / H), i1 = Math.floor(Math.max(s.ax, s.bx) / H);
    const j0 = Math.floor(Math.min(s.ay, s.by) / H), j1 = Math.floor(Math.max(s.ay, s.by) / H);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = hashKey(i, j);
      let list = this.hash.get(k);
      if (!list) this.hash.set(k, (list = []));
      list.push(s);
    }
  }

  segmentsNear(x: number, y: number, radius: number): RoadSeg[] {
    const H = this.H;
    const out = new Set<RoadSeg>();
    for (let j = Math.floor((y - radius) / H); j <= Math.floor((y + radius) / H); j++)
      for (let i = Math.floor((x - radius) / H); i <= Math.floor((x + radius) / H); i++) {
        const list = this.hash.get(hashKey(i, j));
        if (list) for (const s of list) out.add(s);
      }
    return [...out];
  }

  nearest(x: number, y: number, radius = 60, filter?: (r: RoadInfo) => boolean): NearestRoad | null {
    let best: NearestRoad | null = null;
    for (const s of this.segmentsNear(x, y, radius)) {
      if (filter && !filter(s.road)) continue;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - s.ax) * dx + (y - s.ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = s.ax + t * dx, py = s.ay + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d <= radius && (!best || d < best.dist)) {
        const len = Math.sqrt(len2);
        best = { road: s.road, dist: d, x: px, y: py, dx: dx / len, dy: dy / len, h: 0 };
      }
    }
    if (best) best.h = this.surfaceHeight(best.road, best.x, best.y);
    return best;
  }

  /** Height of a road surface near a point (nearest densified vertex). */
  surfaceHeight(r: RoadInfo, x: number, y: number): number {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < r.pts.length; i += 2) {
      const d = (r.pts[i] - x) ** 2 + (r.pts[i + 1] - y) ** 2;
      if (d < bd) { bd = d; bi = i / 2; }
    }
    return r.hs[bi];
  }
}

// ---------------------------------------------------------------------------
// helpers

function hashKey(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }

export function densify(src: number[], step: number): number[] {
  const out: number[] = [src[0], src[1]];
  for (let i = 2; i < src.length; i += 2) {
    const ax = src[i - 2], ay = src[i - 1], bx = src[i], by = src[i + 1];
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 0.01) continue;
    const k = Math.max(1, Math.ceil(d / step));
    for (let s = 1; s <= k; s++) out.push(ax + ((bx - ax) * s) / k, ay + ((by - ay) * s) / k);
  }
  return out;
}

function totalLength(pts: number[]): number {
  let d = 0;
  for (let i = 2; i < pts.length; i += 2) d += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return d;
}

export function dirAt(pts: number[], i: number): [number, number] {
  const n = pts.length / 2;
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  const dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Left/right offset polylines with mitered joints. `center` shifts the strip sideways. */
function offsetLines(pts: number[], half: number, center = 0) {
  const n = pts.length / 2;
  const lx = new Float64Array(n), ly = new Float64Array(n), rx = new Float64Array(n), ry = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let nx = 0, ny = 0;
    if (i > 0) {
      const dx = pts[2 * i] - pts[2 * i - 2], dy = pts[2 * i + 1] - pts[2 * i - 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l; ny += dx / l;
    }
    if (i < n - 1) {
      const dx = pts[2 * i + 2] - pts[2 * i], dy = pts[2 * i + 3] - pts[2 * i + 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l; ny += dx / l;
    }
    let l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    // miter scale
    let segNx = nx, segNy = ny;
    if (i < n - 1) {
      const dx = pts[2 * i + 2] - pts[2 * i], dy = pts[2 * i + 3] - pts[2 * i + 1];
      l = Math.hypot(dx, dy) || 1;
      segNx = -dy / l; segNy = dx / l;
    }
    const m = 1 / Math.max(0.5, nx * segNx + ny * segNy);
    const x = pts[2 * i] + nx * center, y = pts[2 * i + 1] + ny * center;
    lx[i] = x + nx * half * m; ly[i] = y + ny * half * m;
    rx[i] = x - nx * half * m; ry[i] = y - ny * half * m;
  }
  return { lx, ly, rx, ry };
}

/** Pushes a triangle in three.js coords (x, h, -y) making sure it faces up. */
export function pushTri(pos: number[], ax: number, ay: number, ah: number, bx: number, by: number, bh: number, cx: number, cy: number, ch: number): boolean {
  // In world space z = -y. Up-facing (CCW seen from +Y) means cross(b-a, c-a).y > 0
  const ux = bx - ax, uz = -(by - ay), vx = cx - ax, vz = -(cy - ay);
  const cross = uz * vx - ux * vz;
  if (cross >= 0) { pos.push(ax, ah, -ay, bx, bh, -by, cx, ch, -cy); return false; }
  pos.push(ax, ah, -ay, cx, ch, -cy, bx, bh, -by);
  return true;
}

function quad(pos: number[], uv: number[],
  lx0: number, ly0: number, h0: number, rx0: number, ry0: number, h0r: number,
  lx1: number, ly1: number, h1: number, rx1: number, ry1: number, h1r: number,
  v0: number, v1: number) {
  const s1 = pushTri(pos, lx0, ly0, h0, rx0, ry0, h0r, lx1, ly1, h1);
  if (s1) uv.push(0, v0, 0, v1, 1, v0); else uv.push(0, v0, 1, v0, 0, v1);
  const s2 = pushTri(pos, rx0, ry0, h0r, rx1, ry1, h1r, lx1, ly1, h1);
  if (s2) uv.push(1, v0, 0, v1, 1, v1); else uv.push(1, v0, 1, v1, 0, v1);
}

function disc(pos: number[], uv: number[], x: number, y: number, h: number, r: number, seg: number) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const flip = pushTri(pos, x, y, h, x + Math.cos(a0) * r, y + Math.sin(a0) * r, h, x + Math.cos(a1) * r, y + Math.sin(a1) * r, h);
    const u0 = 0.5 + Math.cos(a0) * 0.5, u1 = 0.5 + Math.cos(a1) * 0.5;
    const w0 = Math.sin(a0) * 0.5, w1 = Math.sin(a1) * 0.5;
    if (flip) uv.push(0.5, 0, u1, w1, u0, w0); else uv.push(0.5, 0, u0, w0, u1, w1);
  }
}
