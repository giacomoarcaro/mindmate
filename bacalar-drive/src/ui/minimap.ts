import type { Field } from '../world/field';
import { CELL, LU_FOREST, LU_PARK, LU_RESIDENTIAL } from '../world/field';
import type { RoadNetwork } from '../world/roads';
import type { Footprint } from '../world/buildings';
import type { Poi } from '../data/types';

const ROAD_COLORS: Record<string, string> = {
  primary: '#ffd166', secondary: '#ffffff', residential: '#f1efe9', service: '#e6e2d8', track: '#e8dcb5', path: '#cfc8b8',
};

/**
 * Heading-up circular minimap drawn from the same OSM data: a pre-rendered raster of
 * water and land use, with roads, buildings and landmarks drawn live around the player.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private buildingHash = new Map<number, Footprint[]>();
  /** meters shown from center to edge */
  range = 260;
  /** gym position and people waiting for a ride (set by the game) */
  gym: { x: number; y: number } | null = null;
  waiting: [number, number][] = [];

  constructor(host: HTMLElement, private field: Field, private roads: RoadNetwork, buildings: Footprint[], private landmarks: Poi[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 440;
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // base raster: one pixel per field cell
    const { nx, ny } = field;
    this.base = document.createElement('canvas');
    this.base.width = nx;
    this.base.height = ny;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(nx, ny);
    const deep = [10, 50, 99], shallow = [67, 201, 203], cen = [12, 30, 70];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const o = ((ny - 1 - j) * nx + i) * 4; // flip so north is up in the raster
      let c: number[];
      if (field.water[k] === 2) c = cen;
      else if (field.water[k]) {
        const t = Math.min(1, -field.sd[k] / 120);
        c = [shallow[0] + (deep[0] - shallow[0]) * t, shallow[1] + (deep[1] - shallow[1]) * t, shallow[2] + (deep[2] - shallow[2]) * t];
      } else {
        const lu = field.landuse[k];
        c = lu === LU_FOREST ? [58, 92, 44] : lu === LU_RESIDENTIAL ? [158, 150, 118] : lu === LU_PARK ? [110, 160, 70] : [78, 112, 52];
      }
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    for (const b of buildings) {
      const k = (Math.floor(b.cx / 100) + 512) * 1024 + Math.floor(b.cy / 100) + 512;
      let l = this.buildingHash.get(k);
      if (!l) this.buildingHash.set(k, (l = []));
      l.push(b);
    }
  }

  /** x, y map position; heading clockwise from north (radians) */
  draw(x: number, y: number, heading: number) {
    const c = this.ctx, W = this.canvas.width, R = W / 2;
    const s = R / this.range; // px per meter
    c.save();
    c.clearRect(0, 0, W, W);
    c.translate(R, R);
    c.rotate(-heading);
    // base raster (north up): map (x, y) -> canvas (x, -y)
    const f = this.field;
    c.imageSmoothingEnabled = true;
    const px = (x - f.minX) / CELL, py = (f.ny - 1) - (y - f.minY) / CELL;
    // only the part of the raster around the player
    const half = Math.ceil((this.range * 1.5) / CELL);
    const sx0 = Math.max(0, Math.floor(px - half)), sy0 = Math.max(0, Math.floor(py - half));
    const sw = Math.min(f.nx - sx0, half * 2), sh = Math.min(f.ny - sy0, half * 2);
    if (sw > 0 && sh > 0) c.drawImage(this.base, sx0, sy0, sw, sh, (sx0 - px) * CELL * s, (sy0 - py) * CELL * s, sw * CELL * s, sh * CELL * s);

    // buildings
    c.fillStyle = 'rgba(235, 225, 210, 0.9)';
    const reach = this.range * 1.45;
    for (let i = Math.floor((x - reach) / 100); i <= Math.floor((x + reach) / 100); i++)
      for (let j = Math.floor((y - reach) / 100); j <= Math.floor((y + reach) / 100); j++) {
        const l = this.buildingHash.get((i + 512) * 1024 + j + 512);
        if (!l) continue;
        for (const b of l) {
          c.beginPath();
          for (let k = 0; k < b.ring.length; k += 2) {
            const bx = (b.ring[k] - x) * s, by = -(b.ring[k + 1] - y) * s;
            if (k === 0) c.moveTo(bx, by); else c.lineTo(bx, by);
          }
          c.closePath();
          c.fill();
        }
      }

    // roads
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const segs = this.roads.segmentsNear(x, y, reach);
    for (const pass of [0, 1]) {
      for (const sg of segs) {
        const r = sg.road.src;
        const w = Math.max(1.6, r.width * s * 1.3);
        c.strokeStyle = pass === 0 ? 'rgba(40, 40, 40, 0.55)' : ROAD_COLORS[r.cls] ?? '#fff';
        c.lineWidth = pass === 0 ? w + 2 : w;
        c.beginPath();
        c.moveTo((sg.ax - x) * s, -(sg.ay - y) * s);
        c.lineTo((sg.bx - x) * s, -(sg.by - y) * s);
        c.stroke();
      }
    }

    // landmarks
    c.font = '600 17px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const l of this.landmarks) {
      const lx = (l.x - x) * s, ly = -(l.y - y) * s;
      if (lx * lx + ly * ly > (R * 1.4) ** 2) continue;
      c.fillStyle = '#ff5a3c';
      c.beginPath(); c.arc(lx, ly, 6, 0, Math.PI * 2); c.fill();
      c.save();
      c.translate(lx, ly);
      c.rotate(heading);
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 3;
      c.strokeText(l.name, 0, -12);
      c.fillText(l.name, 0, -12);
      c.restore();
    }

    // people who want a ride to the gym
    c.fillStyle = '#b4e23c';
    c.strokeStyle = '#20252a';
    c.lineWidth = 3;
    for (const [wx, wy] of this.waiting) {
      c.beginPath(); c.arc((wx - x) * s, -(wy - y) * s, 7, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // the gym: marker when in range, arrow on the rim when far
    if (this.gym) {
      const gx = (this.gym.x - x) * s, gy = -(this.gym.y - y) * s;
      const gd = Math.hypot(gx, gy);
      c.save();
      if (gd < R - 26) c.translate(gx, gy);
      else c.translate((gx / gd) * (R - 26), (gy / gd) * (R - 26));
      c.rotate(heading);
      c.fillStyle = '#b4e23c';
      c.strokeStyle = '#20252a';
      c.lineWidth = 4;
      c.beginPath(); c.arc(0, 0, 19, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#20252a';
      c.font = '900 15px system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.fillText('GYM', 0, 1);
      c.restore();
    }

    // north marker on the rim
    c.save();
    c.rotate(0);
    c.fillStyle = '#ff5a3c';
    c.font = '800 24px system-ui, sans-serif';
    c.translate(0, -R + 22);
    c.rotate(heading);
    c.fillText('N', 0, 8);
    c.restore();
    c.restore();

    // player arrow (always pointing up)
    c.save();
    c.translate(R, R);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#0b3f63';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, -16); c.lineTo(11, 12); c.lineTo(0, 6); c.lineTo(-11, 12); c.closePath();
    c.fill(); c.stroke();
    c.restore();
  }
}
