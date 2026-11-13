import * as THREE from 'three';
import type { Footprint } from './buildings';
import type { Tile } from './world';

/** One street-level photo from Mapillary: map position, compass heading (deg), image file. */
export interface FacadePhoto { id: string; x: number; y: number; h: number }
interface Manifest { attribution: string; photos: FacadePhoto[] }

const CELL = 128;
const GRID = 8;

/**
 * Real facade photos (Mapillary, CC BY-SA) projected onto the street-facing wall of nearby
 * buildings. Photos are downloaded ahead of time by scripts/fetch-facades.ts; nothing is
 * requested from Mapillary at runtime. Each tile gets one texture atlas, filled as images load.
 */
export class FacadeStore {
  static async load(baseUrl: string): Promise<FacadeStore | null> {
    try {
      const res = await fetch(`${baseUrl}data/facades.json`);
      if (!res.ok) return null;
      const m = (await res.json()) as Manifest;
      return m.photos?.length ? new FacadeStore(m, baseUrl) : null;
    } catch { return null; }
  }

  readonly attribution: string;
  private hash = new Map<number, FacadePhoto[]>();
  private images = new Map<string, Promise<HTMLImageElement | null>>();
  readonly count: number;

  private constructor(m: Manifest, private baseUrl: string) {
    this.attribution = m.attribution;
    this.count = m.photos.length;
    for (const p of m.photos) {
      const k = this.key(Math.floor(p.x / 30), Math.floor(p.y / 30));
      let l = this.hash.get(k);
      if (!l) this.hash.set(k, (l = []));
      l.push(p);
    }
  }

  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }

  private image(id: string) {
    let p = this.images.get(id);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `${this.baseUrl}facades/${id}.jpg`;
      });
      this.images.set(id, p);
    }
    return p;
  }

  /**
   * Best photo for a building: the camera must be in front of one of its walls, within 30 m,
   * with that wall off to one side of the view (forward-facing street photos show facades
   * on their left and right halves).
   */
  match(f: Footprint): { wall: number; photo: FacadePhoto; left: boolean } | null {
    const n = f.ring.length / 2;
    let best: { wall: number; photo: FacadePhoto; left: boolean; score: number } | null = null;
    const ci = Math.floor(f.cx / 30), cj = Math.floor(f.cy / 30);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const list = this.hash.get(this.key(i, j));
      if (!list) continue;
      for (const p of list) {
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const ax = f.ring[2 * k], ay = f.ring[2 * k + 1], bx = f.ring[2 * k2], by = f.ring[2 * k2 + 1];
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 4) continue;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const vx = p.x - mx, vy = p.y - my, d = Math.hypot(vx, vy);
          if (d > 30 || d < 3) continue;
          // outward normal of a CCW ring edge
          const nx = (by - ay) / len, ny = -(bx - ax) / len;
          const facing = (nx * vx + ny * vy) / d;
          if (facing < 0.45) continue;
          // bearing of the wall from the camera, relative to the camera heading
          const bearing = Math.atan2(-vx, -vy) * 180 / Math.PI;
          let rel = bearing - p.h;
          rel = ((rel + 540) % 360) - 180;
          const a = Math.abs(rel);
          if (a < 18 || a > 80) continue;
          const score = d * (1.4 - facing) + Math.abs(a - 45) * 0.15 - Math.min(len, 12) * 0.3;
          if (!best || score < best.score) best = { wall: k, photo: p, left: rel < 0, score };
        }
      }
    }
    return best;
  }

  /** Atlas for one tile; returns a function that reserves a cell and gives back its UV rect. */
  atlas(tile: Tile) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL * GRID;
    const g = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    let used = 0;
    let disposed = false;
    const prev = tile.dispose;
    tile.dispose = () => { prev(); disposed = true; tex.dispose(); };
    const reserve = (photo: FacadePhoto, left: boolean, fallback: THREE.Color) => {
      if (used >= GRID * GRID) return null;
      const cx = (used % GRID) * CELL, cy = Math.floor(used / GRID) * CELL;
      used++;
      g.fillStyle = `#${fallback.getHexString(THREE.SRGBColorSpace)}`;
      g.fillRect(cx, cy, CELL, CELL);
      void this.image(photo.id).then((img) => {
        if (!img || disposed) return;
        // the facade sits in one half of the frame, between the sky and the road
        const sw = img.width * 0.42, sx = left ? img.width * 0.04 : img.width * 0.54;
        const sy = img.height * 0.22, sh = img.height * 0.5;
        g.drawImage(img, sx, sy, sw, sh, cx + 1, cy + 1, CELL - 2, CELL - 2);
        tex.needsUpdate = true;
      });
      const e = 1.5 / (CELL * GRID);
      // canvas y grows downward, texture v grows upward
      return { u0: cx / (CELL * GRID) + e, u1: (cx + CELL) / (CELL * GRID) - e, v0: 1 - (cy + CELL) / (CELL * GRID) + e, v1: 1 - cy / (CELL * GRID) - e };
    };
    return { tex, reserve, used: () => used };
  }
}
