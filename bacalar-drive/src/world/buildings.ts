import * as THREE from 'three';
import type { MapData, Ring } from '../data/types';
import type { Field } from './field';
import { LU_RESIDENTIAL } from './field';
import type { RoadNetwork } from './roads';
import type { TileGrid } from './tilegrid';
import type { Tile, TileLayer } from './world';
import { facadeTexture, rng, roofTexture, windowGlowTexture } from '../render/textures';
import { pushTri } from './roads';
import type { FacadeStore } from './facades';
import type { Poi } from '../data/types';
import { SignAtlas, shopStyle, type ShopStyle } from './shops';

/** Colors of the painted band at the foot of the walls (guardapolvo). */
const TRIM = ['#7a2e2a', '#2f5d50', '#8a5a2b', '#1f4e79', '#5a5a5a', '#b9533a', '#3d6b35'];

/** Mexican town palette */
const PALETTE = ['#f4f1ea', '#f4f1ea', '#f0ebe0', '#e3b04b', '#d9a441', '#3fb8af', '#58c4c6', '#e88fa8', '#f2a7b8', '#c8643b', '#d97a4a', '#f1d77a', '#8fc9e3'];
const ROOF_COLORS = ['#d8d4cc', '#cfcac0', '#bdb7ab', '#e2ded6', '#b9533a'];

export interface Footprint {
  ring: Ring;            // outer ring, CCW
  holes: Ring[];
  height: number;
  color: THREE.Color;
  roof: THREE.Color;
  tank: boolean;         // black water tank (tinaco) on the roof
  cx: number; cy: number;
  osm: boolean;
  trim: THREE.Color;
  /** business inside, from OSM points */
  shop?: { name: string; style: ShopStyle };
  /** index of the outer wall that faces the street (computed on first build) */
  front?: number;
}

export class BuildingSet implements TileLayer {
  readonly all: Footprint[] = [];
  private byTile = new Map<number, Footprint[]>();
  private hash = new Map<number, Footprint[]>();
  readonly wallMat: THREE.MeshLambertMaterial;
  readonly roofMat: THREE.MeshLambertMaterial;
  readonly detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private signMat: THREE.MeshLambertMaterial | null = null;
  private liveSignMats = new Set<THREE.MeshLambertMaterial>();
  /** Areas where no buildings may be placed (landmarks). x, y, radius */
  exclusions: { x: number; y: number; r: number }[] = [];
  /** optional real facade photos (Mapillary) */
  facades: FacadeStore | null = null;

  constructor(private data: MapData, private field: Field, private roads: RoadNetwork, private grid: TileGrid, exclusions: { x: number; y: number; r: number }[] = []) {
    this.exclusions = exclusions;
    this.wallMat = new THREE.MeshLambertMaterial({ map: facadeTexture(), vertexColors: true, emissiveMap: windowGlowTexture(), emissive: new THREE.Color('#ffb860'), emissiveIntensity: 0 });
    this.roofMat = new THREE.MeshLambertMaterial({ map: roofTexture(), vertexColors: true });
    const r = rng(1234);

    for (const b of data.buildings) {
      const ring = ccw(b.rings[0]);
      const [cx, cy] = centroid(ring);
      if (this.excluded(cx, cy)) continue;
      let height = b.height ?? (b.levels ? b.levels * 3 + 0.4 : (r() < 0.55 ? 3.4 : 6.4));
      height = Math.max(2.6, Math.min(40, height));
      this.add({
        ring, holes: b.rings.slice(1).map((h) => cw(h)), height,
        color: new THREE.Color(PALETTE[Math.floor(r() * PALETTE.length)]),
        roof: new THREE.Color(ROOF_COLORS[Math.floor(r() * ROOF_COLORS.length)]),
        tank: r() < 0.5, cx, cy, osm: b.source !== 'ms',
        trim: new THREE.Color(TRIM[Math.floor(r() * TRIM.length)]),
      });
    }
    // with real satellite footprints there is no need to invent houses
    if (!data.buildings.some((b) => b.source === 'ms')) this.scatterHouses(r);
  }

  private excluded(x: number, y: number) {
    return this.exclusions.some((e) => (x - e.x) ** 2 + (y - e.y) ** 2 < e.r * e.r);
  }

  private add(f: Footprint) {
    this.all.push(f);
    const k = this.grid.keyAt(f.cx, f.cy);
    let list = this.byTile.get(k);
    if (!list) this.byTile.set(k, (list = []));
    list.push(f);
    const hk = hkey(Math.floor(f.cx / 30), Math.floor(f.cy / 30));
    let hl = this.hash.get(hk);
    if (!hl) this.hash.set(hk, (hl = []));
    hl.push(f);
    this.field.markPolygon(f.ring, 1.5);
  }

  private anyBuildingNear(x: number, y: number, r: number): boolean {
    const i0 = Math.floor((x - r) / 30), i1 = Math.floor((x + r) / 30);
    const j0 = Math.floor((y - r) / 30), j1 = Math.floor((y + r) / 30);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = this.hash.get(hkey(i, j));
      if (!l) continue;
      for (const f of l) {
        // distance to footprint approximated by vertex / centroid distance
        if ((f.cx - x) ** 2 + (f.cy - y) ** 2 < r * r) return true;
        for (let k = 0; k < f.ring.length; k += 2) if ((f.ring[k] - x) ** 2 + (f.ring[k + 1] - y) ** 2 < (r * 0.6) ** 2) return true;
      }
    }
    return false;
  }

  /**
   * Residential areas in OSM have streets but almost no building footprints.
   * Place simple houses along those streets every 15-25 m on both sides.
   */
  private scatterHouses(r: () => number) {
    const town = /^(residential|unclassified|living_street|tertiary|secondary|primary)$/;
    const town0 = this.data.landmarks.find((l) => l.kind === 'place:town');
    const townCenter = town0 ? { x: town0.x, y: town0.y } : { x: 0, y: 0 };
    for (const road of this.roads.roads) {
      const src = road.src;
      if (!town.test(src.hw) || !src.paved && src.cls !== 'residential') continue;
      const pts = road.pts;
      for (const side of [1, -1]) {
        let along = 6 + r() * 10;
        let acc = 0;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
          const seg = Math.hypot(bx - ax, by - ay);
          while (along < acc + seg) {
            const t = (along - acc) / seg;
            const dx = (bx - ax) / seg, dy = (by - ay) / seg;
            const nx = -dy * side, ny = dx * side;
            const width = 7 + r() * 4;       // along the road
            const depth = 8 + r() * 6;       // away from the road
            const setback = src.width / 2 + 1.5 + r() * 3;
            const cx = ax + dx * seg * t + nx * (setback + depth / 2);
            const cy = ay + dy * seg * t + ny * (setback + depth / 2);
            along += 15 + r() * 10;
            const inTown = this.field.landuseAt(cx, cy) === LU_RESIDENTIAL || Math.hypot(cx - townCenter.x, cy - townCenter.y) < 1600;
            if (!inTown) continue;
            if (this.excluded(cx, cy)) continue;
            if (this.field.shoreDist(cx, cy) < Math.max(width, depth) / 2 + 4) continue;
            if (this.anyBuildingNear(cx, cy, 11)) continue;
            // keep clear of every road (including the one we follow, other than by the setback)
            const near = this.roads.segmentsNear(cx, cy, 25);
            let clash = false;
            for (const s of near) {
              const d = segDist(cx, cy, s.ax, s.ay, s.bx, s.by);
              if (d < s.road.src.width / 2 + Math.min(width, depth) / 2 + 0.8) { clash = true; break; }
            }
            if (clash) continue;
            const ring = rectRing(cx, cy, dx, dy, width, depth);
            const floors = r() < 0.7 ? 1 : 2;
            this.add({
              ring, holes: [], height: floors * 3 + 0.4,
              color: new THREE.Color(PALETTE[Math.floor(r() * PALETTE.length)]).multiplyScalar(0.92 + r() * 0.08),
              roof: new THREE.Color(ROOF_COLORS[Math.floor(r() * ROOF_COLORS.length)]),
              tank: r() < 0.6, cx, cy, osm: false,
              trim: new THREE.Color(TRIM[Math.floor(r() * TRIM.length)]),
            });
          }
          acc += seg;
        }
      }
    }
  }

  /** Put each named business from the map into the building that contains it (or the nearest one). */
  assignShops(pois: Poi[]) {
    let n = 0;
    for (const p of pois) {
      const style = shopStyle(p.kind);
      if (!style) continue;
      let best: Footprint | null = null, bd = 22;
      const i0 = Math.floor(p.x / 30), j0 = Math.floor(p.y / 30);
      for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
        for (const f of this.hash.get(hkey(i, j)) ?? []) {
          if (f.shop) continue;
          const d = pointInPoly(f.ring, p.x, p.y) ? 0 : Math.hypot(f.cx - p.x, f.cy - p.y);
          if (d < bd) { bd = d; best = f; }
        }
      }
      if (best) { best.shop = { name: p.name, style }; n++; }
    }
    return n;
  }

  /** Painted base band on every wall, a door on the street side, storefront, awning and sign for businesses. */
  private addDetails(f: Footprint, gmin: number, base: number,
    wp: number[], wuv: number[], wc: number[], dp: number[], duv: number[], dc: number[],
    sp: number[], suv: number[], atlas: () => SignAtlas) {
    const n = f.ring.length / 2;
    const band = gmin + 0.85;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = f.ring[2 * k], ay = f.ring[2 * k + 1], bx = f.ring[2 * k2], by = f.ring[2 * k2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.3) continue;
      const ox = ((by - ay) / len) * 0.03, oy = (-(bx - ax) / len) * 0.03;
      wallQuad(wp, wuv, ax + ox, ay + oy, bx + ox, by + oy, base, band, 0, len / 3.2, 0.02, 0.2);
      for (let q = 0; q < 6; q++) wc.push(f.trim.r, f.trim.g, f.trim.b);
    }
    const k = this.frontWall(f);
    const k2 = (k + 1) % n;
    const ax = f.ring[2 * k], ay = f.ring[2 * k + 1], bx = f.ring[2 * k2], by = f.ring[2 * k2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 2.5) return;
    const dx = (bx - ax) / len, dy = (by - ay) / len;   // along the wall
    const nx = dy, ny = -dx;                             // outward
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const at = (along: number, out: number): [number, number] => [mx + dx * along + nx * out, my + dy * along + ny * out];
    const quad = (a0: number, a1: number, h0: number, h1: number, out: number, color: string) => {
      const [x0, y0] = at(a0, out), [x1, y1] = at(a1, out);
      wallQuad(dp, duv, x0, y0, x1, y1, h0, h1, 0, 0, 0, 0);
      const c = new THREE.Color(color);
      for (let q = 0; q < 6; q++) dc.push(c.r, c.g, c.b);
    };
    if (!f.shop) {
      // a wooden door, off center
      const off = len > 6 ? -len * 0.22 : 0;
      quad(off - 0.55, off + 0.55, gmin, gmin + 2.15, 0.06, '#5b3a22');
      quad(off - 0.65, off + 0.65, gmin + 2.15, gmin + 2.3, 0.07, '#e9e4d8');
      return;
    }
    const s = f.shop.style;
    const w = Math.min(len * 0.82, 6.4);
    // open storefront with the roll-up shutter showing above it
    quad(-w * 0.4, w * 0.4, gmin, gmin + 2.4, 0.06, '#2a2420');
    quad(-w * 0.4, w * 0.4, gmin + 2.2, gmin + 2.45, 0.07, '#9aa0a6');
    // striped awning sloping out over the sidewalk
    const stripes = Math.max(4, Math.round(w / 0.55));
    const h0 = gmin + 2.75, h1 = gmin + 2.3;
    for (let i = 0; i < stripes; i++) {
      const a0 = -w / 2 + (w * i) / stripes, a1 = -w / 2 + (w * (i + 1)) / stripes;
      const [x0, y0] = at(a0, 0.08), [x1, y1] = at(a1, 0.08), [x2, y2] = at(a1, 1.25), [x3, y3] = at(a0, 1.25);
      dp.push(x0, h0, -y0, x1, h0, -y1, x2, h1, -y2, x0, h0, -y0, x2, h1, -y2, x3, h1, -y3);
      for (let q = 0; q < 6; q++) duv.push(0, 0);
      const c = new THREE.Color(s.awning[i % 2]);
      for (let q = 0; q < 6; q++) dc.push(c.r, c.g, c.b);
    }
    // valance
    quad(-w / 2, w / 2, h1 - 0.22, h1, 1.25, s.awning[0]);
    // painted sign board above the awning
    const cell = atlas().add(f.shop.name, s);
    if (!cell) return;
    const sh = Math.min(w / 4, 1.25), sw = sh * 4;
    const [x0, y0] = at(-sw / 2, 0.1), [x1, y1] = at(sw / 2, 0.1);
    wallQuad(sp, suv, x0, y0, x1, y1, h0 + 0.12, h0 + 0.12 + sh, cell.u0, cell.u1, cell.v0, cell.v1);
  }

  /** Outer wall facing the closest street. */
  private frontWall(f: Footprint) {
    if (f.front !== undefined) return f.front;
    let best = 0, bd = Infinity;
    const n = f.ring.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = f.ring[2 * k], ay = f.ring[2 * k + 1], bx = f.ring[2 * k2], by = f.ring[2 * k2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 2.5) continue;
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      const mx = (ax + bx) / 2 + nx * 2, my = (ay + by) / 2 + ny * 2;
      const road = this.roads.nearest(mx, my, 40, (r) => r.src.cls !== 'path');
      if (!road) continue;
      const toward = (road.x - mx) * nx + (road.y - my) * ny;
      const d = road.dist - Math.max(0, toward) * 0.5 - Math.min(len, 10) * 0.2;
      if (toward > -1 && d < bd) { bd = d; best = k; }
    }
    f.front = best;
    return best;
  }

  setNight(night: number) {
    if (this.signMat) this.signMat.emissiveIntensity = night * 0.7;
    for (const m of this.liveSignMats) m.emissiveIntensity = night * 0.7; this.wallMat.emissiveIntensity = night * 0.9; }

  count() { return { osm: this.all.filter((f) => f.osm).length, procedural: this.all.filter((f) => !f.osm).length }; }

  // -------------------------------------------------------------------------

  build(tile: Tile) {
    const list = this.byTile.get(tile.key);
    if (!list?.length) return;
    const wp: number[] = [], wuv: number[] = [], wc: number[] = [];
    const rp: number[] = [], ruv: number[] = [], rc: number[] = [];
    const tmpC = new THREE.Color();
    const pp: number[] = [], puv: number[] = [];
    const dp: number[] = [], duv: number[] = [], dc: number[] = [];
    const sp: number[] = [], suv: number[] = [];
    let signs: SignAtlas | null = null;
    const atlas = this.facades?.atlas(tile);

    for (const f of list) {
      const photo = atlas ? this.facades!.match(f) : null;
      let gmin = Infinity, gmax = -Infinity;
      for (let k = 0; k < f.ring.length; k += 2) {
        const h = this.field.heightAt(f.ring[k], f.ring[k + 1]);
        gmin = Math.min(gmin, h); gmax = Math.max(gmax, h);
      }
      const base = gmin - 0.6;
      const top = gmax + f.height;
      for (const ring of [f.ring, ...f.holes]) {
        const n = ring.length / 2;
        let u = 0;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * k2], by = ring[2 * k2 + 1];
          const len = Math.hypot(bx - ax, by - ay);
          const u0 = u / 3.2, u1 = (u + len) / 3.2;
          u += len;
          const v0 = (base - gmax) / 3, v1 = (top - 0.4 - gmax) / 3;
          // outward normal for a CCW outer / CW hole ring is (dy, -dx)
          wallQuad(wp, wuv, ax, ay, bx, by, base, top, u0, u1, v0, v1);
          for (let q = 0; q < 6; q++) wc.push(f.color.r, f.color.g, f.color.b);
          if (photo && ring === f.ring && k === photo.wall) {
            const cell = atlas!.reserve(photo.photo, photo.left, f.color);
            if (cell) {
              // photo panel just in front of the wall, from the ground to the roof line
              const ox = ((by - ay) / len) * 0.06, oy = (-(bx - ax) / len) * 0.06;
              wallQuad(pp, puv, ax + ox, ay + oy, bx + ox, by + oy, gmin, top - 0.05, cell.u0, cell.u1, cell.v0, cell.v1);
            }
          }
        }
      }
      this.addDetails(f, gmin, base, wp, wuv, wc, dp, duv, dc, sp, suv, () => (signs ??= new SignAtlas()));
      // roof
      const contour = toV2(f.ring);
      const holes = f.holes.map(toV2);
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const verts = contour.concat(...holes);
      tmpC.copy(f.roof);
      for (const [a, b, c] of tris) {
        pushTri(rp, verts[a].x, verts[a].y, top, verts[b].x, verts[b].y, top, verts[c].x, verts[c].y, top);
        ruv.push(verts[a].x / 4, verts[a].y / 4, verts[b].x / 4, verts[b].y / 4, verts[c].x / 4, verts[c].y / 4);
        for (let q = 0; q < 3; q++) rc.push(tmpC.r, tmpC.g, tmpC.b);
      }
      // parapet ring (thin wall on the roof edge) is implied by the roof color; add a tinaco
      if (f.tank) {
        const tx = f.cx + (Math.sin(f.cx) * 0.5) * 2, ty = f.cy + (Math.cos(f.cy) * 0.5) * 2;
        box(rp, ruv, rc, tx, ty, top, 0.6, 0.6, 1.1, 0.12, 0.12, 0.12);
      }
    }

    const walls = mesh(wp, wuv, wc, this.wallMat);
    const roofs = mesh(rp, ruv, rc, this.roofMat);
    tile.group.add(walls, roofs);
    walls.castShadow = roofs.castShadow = true;
    walls.receiveShadow = roofs.receiveShadow = true;
    if (atlas && pp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pp), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(puv), 2));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const photos = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlas.tex }));
      photos.userData.ownedByTile = true;
      photos.receiveShadow = true;
      tile.group.add(photos);
    }

    if (dp.length) {
      const details = mesh(dp, duv, dc, this.detailMat);
      details.castShadow = true;
      tile.group.add(details);
    }
    if (signs && sp.length) {
      const atlas: SignAtlas = signs;
      if (!this.signMat) this.signMat = new THREE.MeshLambertMaterial({ emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
      const mat = this.signMat.clone();
      mat.map = atlas.tex;
      mat.emissiveMap = atlas.tex;
      mat.emissiveIntensity = this.signMat.emissiveIntensity;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sp), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(suv), 2));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const signMesh = new THREE.Mesh(g, mat);
      signMesh.userData.ownedByTile = true;
      signMesh.userData.signMat = true;
      tile.group.add(signMesh);
      this.liveSignMats.add(mat);
      const prev = tile.dispose;
      tile.dispose = () => { prev(); atlas.tex.dispose(); mat.dispose(); this.liveSignMats.delete(mat); };
    }
    const pa = walls.geometry.getAttribute('position').array as Float32Array;
    const idx = new Uint32Array(pa.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    tile.colliders.meshes.push({ positions: pa, indices: idx });
  }
}

// ---------------------------------------------------------------------------

function hkey(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }

function signedArea(r: Ring) {
  let a = 0;
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    a += r[2 * k] * r[2 * k2 + 1] - r[2 * k2] * r[2 * k + 1];
  }
  return a / 2;
}

function reverseRing(r: Ring): Ring {
  const out: number[] = [];
  for (let k = r.length - 2; k >= 0; k -= 2) out.push(r[k], r[k + 1]);
  return out;
}

export function ccw(r: Ring): Ring { return signedArea(r) >= 0 ? r : reverseRing(r); }
export function cw(r: Ring): Ring { return signedArea(r) < 0 ? r : reverseRing(r); }

export function centroid(r: Ring): [number, number] {
  let x = 0, y = 0;
  const n = r.length / 2;
  for (let k = 0; k < r.length; k += 2) { x += r[k]; y += r[k + 1]; }
  return [x / n, y / n];
}

function toV2(r: Ring) {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < r.length; k += 2) out.push(new THREE.Vector2(r[k], r[k + 1]));
  return out;
}

export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

/** CCW rectangle centered on (cx, cy) with "width" along (dx, dy) and "depth" across. */
function rectRing(cx: number, cy: number, dx: number, dy: number, width: number, depth: number): Ring {
  const nx = -dy, ny = dx;
  const hw = width / 2, hd = depth / 2;
  const pts = [
    [cx - dx * hw - nx * hd, cy - dy * hw - ny * hd],
    [cx + dx * hw - nx * hd, cy + dy * hw - ny * hd],
    [cx + dx * hw + nx * hd, cy + dy * hw + ny * hd],
    [cx - dx * hw + nx * hd, cy - dy * hw + ny * hd],
  ];
  return ccw(pts.flat());
}

/** Vertical quad from a to b (map coords) facing to the right of a->b. */
export function wallQuad(pos: number[], uv: number[], ax: number, ay: number, bx: number, by: number, y0: number, y1: number, u0: number, u1: number, v0: number, v1: number) {
  // world coords: (x, h, -y). Right side of a->b in map coords is (dy, -dx).
  pos.push(
    ax, y0, -ay, bx, y0, -by, bx, y1, -by,
    ax, y0, -ay, bx, y1, -by, ax, y1, -ay,
  );
  uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
}

/** Small box (for roof details) with flat color. */
function box(pos: number[], uv: number[], col: number[], x: number, y: number, h0: number, sx: number, sy: number, sz: number, r: number, g: number, b: number) {
  const x0 = x - sx, x1 = x + sx, y0 = y - sy, y1 = y + sy, h1 = h0 + sz;
  const ring = [x0, y0, x1, y0, x1, y1, x0, y1];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    wallQuad(pos, uv, ring[2 * k], ring[2 * k + 1], ring[2 * k2], ring[2 * k2 + 1], h0, h1, 0, 0, 0, 0);
    for (let q = 0; q < 6; q++) col.push(r, g, b);
  }
  pushTri(pos, x0, y0, h1, x1, y0, h1, x1, y1, h1);
  pushTri(pos, x0, y0, h1, x1, y1, h1, x0, y1, h1);
  for (let q = 0; q < 6; q++) { uv.push(0, 0); col.push(r, g, b); }
}

function mesh(p: number[], uv: number[], c: number[], mat: THREE.Material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.userData.ownedByTile = true;
  return m;
}

function pointInPoly(r: Ring, x: number, y: number) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
