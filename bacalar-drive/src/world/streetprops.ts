import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Field, LU_RESIDENTIAL } from './field';
import type { RoadInfo, RoadNetwork } from './roads';
import type { TileGrid } from './tilegrid';
import type { Tile, TileLayer } from './world';
import { MeshBuilder } from './geom';
import { concreteTexture, rng } from '../render/textures';

const LIFT: Record<string, number> = { primary: 0.16, secondary: 0.14, residential: 0.12, service: 0.1 };
const CURB = 0.17;
const WALK = 1.7;

interface Pole { x: number; y: number; h: number; yaw: number }
interface Car { x: number; y: number; h: number; yaw: number; color: THREE.Color }
interface Dog { x: number; y: number; h: number; yaw: number; color: THREE.Color }
interface TileProps {
  walk: MeshBuilder;
  topes: MeshBuilder;
  poles: Pole[];
  wires: number[];
  cars: Car[];
  dogs: Dog[];
}

const CAR_COLORS = ['#f2f2f0', '#f2f2f0', '#c0c3c7', '#9a9ea3', '#b3261e', '#1f3b6e', '#d8c8a8', '#26282b', '#3f6b52', '#e0a020'];
const DOG_COLORS = ['#c9a26b', '#7b4a26', '#e8dcc4', '#3a2a1e', '#a8743f'];

function colored(g: THREE.BufferGeometry, c: string) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** Plain sedan in the style of the cars parked all over Mexican towns. Body is white so instance color tints it. */
function carGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.7, 0.62, 4.15).translate(0, 0.62, 0), '#ffffff'),
    colored(new THREE.BoxGeometry(1.52, 0.52, 2.0).translate(0, 1.18, 0.25), '#ffffff'),
    colored(new THREE.BoxGeometry(1.54, 0.4, 1.9).translate(0, 1.17, 0.25), '#2a3138'),
    colored(new THREE.BoxGeometry(1.74, 0.16, 0.14).translate(0, 0.42, -2.08), '#3a3a3a'),
    colored(new THREE.BoxGeometry(1.74, 0.16, 0.14).translate(0, 0.42, 2.08), '#3a3a3a'),
    ...[-1.3, 1.3].flatMap((z) => [-0.8, 0.8].map((x) =>
      colored(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 10).rotateZ(Math.PI / 2).translate(x, 0.31, z), '#1b1b1b'))),
  ]);
}

function dogGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.34, 0.24, 0.7).translate(0, 0.12, 0), '#ffffff'),
    colored(new THREE.BoxGeometry(0.26, 0.22, 0.26).translate(0.06, 0.16, -0.42), '#ffffff'),
    colored(new THREE.BoxGeometry(0.12, 0.08, 0.14).translate(0.06, 0.12, -0.58), '#ffffff'),
    colored(new THREE.BoxGeometry(0.06, 0.1, 0.05).translate(-0.02, 0.31, -0.38), '#444444'),
    colored(new THREE.BoxGeometry(0.06, 0.1, 0.05).translate(0.14, 0.31, -0.38), '#444444'),
    colored(new THREE.BoxGeometry(0.06, 0.06, 0.32).translate(0, 0.08, 0.48).rotateY(0.4), '#ffffff'),
  ]);
}

function poleGeometry() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.1, 0.15, 8.6, 6).translate(0, 4.3, 0), '#a7a49c'),
    colored(new THREE.BoxGeometry(1.7, 0.12, 0.12).translate(0, 7.9, 0), '#8a8780'),
    colored(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 8).translate(0.35, 7.2, 0.25), '#5d6266'),
  ]);
}

/**
 * Street furniture for town streets: raised sidewalks with curbs, utility poles with sagging
 * wires, topes (speed bumps), parked cars and dogs napping in the shade.
 */
export class StreetProps implements TileLayer {
  private byTile = new Map<number, TileProps>();
  private walkMat = new THREE.MeshLambertMaterial({ map: concreteTexture(), vertexColors: true });
  private plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private wireMat = new THREE.LineBasicMaterial({ color: '#1d1d1d' });
  private carGeo = carGeometry();
  private dogGeo = dogGeometry();
  private poleGeo = poleGeometry();
  readonly stats = { walkSegments: 0, poles: 0, topes: 0, cars: 0, dogs: 0 };

  constructor(private roads: RoadNetwork, private field: Field, private grid: TileGrid) {
    const r = rng(4242);
    for (const road of roads.roads) {
      const cls = road.src.cls;
      if (!(cls in LIFT) || !road.src.paved) continue;
      this.sidewalks(road);
      if (cls === 'residential' || cls === 'secondary') {
        this.polesAndWires(road, r);
        this.topes(road, r);
        this.parked(road, r);
      }
    }
  }

  private bucket(x: number, y: number): TileProps {
    const k = this.grid.keyAt(x, y);
    let t = this.byTile.get(k);
    if (!t) this.byTile.set(k, (t = { walk: new MeshBuilder(), topes: new MeshBuilder(), poles: [], wires: [], cars: [], dogs: [] }));
    return t;
  }

  private inTown(x: number, y: number) {
    return this.field.landuseAt(x, y) === LU_RESIDENTIAL && this.field.shoreDist(x, y) > 2;
  }

  /** True if a point sits on (or right next to) another road: used to cut props at junctions. */
  private onOtherRoad(road: RoadInfo, x: number, y: number, margin: number) {
    for (const s of this.roads.segmentsNear(x, y, 14)) {
      if (s.road === road || s.road.src.cls === 'path') continue;
      const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
      if (Math.hypot(s.ax + t * dx - x, s.ay + t * dy - y) < s.road.src.width / 2 + margin) return true;
    }
    return false;
  }

  private roadH(road: RoadInfo, x: number, y: number) {
    return this.field.heightAt(x, y) + (LIFT[road.src.cls] ?? 0.1);
  }

  /** Unit left normals at each densified point (averaged at bends). */
  private normals(pts: number[]) {
    const n = pts.length / 2;
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
      const l = Math.hypot(dx, dy) || 1;
      out.push([-dy / l, dx / l]);
    }
    return out;
  }

  private sidewalks(road: RoadInfo) {
    const pts = road.pts, n = pts.length / 2;
    const nrm = this.normals(pts);
    const hw = road.src.width / 2;
    for (const side of [1, -1]) {
      for (let i = 0; i < n - 1; i++) {
        const mx = (pts[2 * i] + pts[2 * i + 2]) / 2, my = (pts[2 * i + 1] + pts[2 * i + 3]) / 2;
        if (!this.inTown(mx, my)) continue;
        const p = (j: number, off: number): [number, number] => [pts[2 * j] + nrm[j][0] * off * side, pts[2 * j + 1] + nrm[j][1] * off * side];
        const [ia, ib] = [p(i, hw), p(i + 1, hw)];
        const [oa, ob] = [p(i, hw + WALK), p(i + 1, hw + WALK)];
        if (this.onOtherRoad(road, oa[0], oa[1], 0.6) || this.onOtherRoad(road, ob[0], ob[1], 0.6)
          || this.onOtherRoad(road, ia[0], ia[1], 0.6) || this.onOtherRoad(road, ib[0], ib[1], 0.6)) continue;
        const t = this.bucket(mx, my);
        const hia = this.roadH(road, ia[0], ia[1]), hib = this.roadH(road, ib[0], ib[1]);
        const toa = Math.max(hia, this.field.heightAt(oa[0], oa[1])) + CURB, tob = Math.max(hib, this.field.heightAt(ob[0], ob[1])) + CURB;
        const tia = hia + CURB, tib = hib + CURB;
        t.walk.color('#e6e1d6');
        t.walk.triUp(ia[0], ia[1], tia, ib[0], ib[1], tib, ob[0], ob[1], tob, 0.5);
        t.walk.triUp(ia[0], ia[1], tia, ob[0], ob[1], tob, oa[0], oa[1], toa, 0.5);
        // curb face toward the roadway, painted at the corners like in town
        t.walk.color('#cfc9bb');
        if (side > 0) t.walk.wall(ia[0], ia[1], ib[0], ib[1], hia - 0.05, ia[0], ia[1], ib[0], ib[1], tia, 0.5);
        else t.walk.wall(ib[0], ib[1], ia[0], ia[1], hib - 0.05, ib[0], ib[1], ia[0], ia[1], tib, 0.5);
        // back edge down to the lots
        if (side > 0) t.walk.wall(ob[0], ob[1], oa[0], oa[1], tob - 0.6, ob[0], ob[1], oa[0], oa[1], tob, 0.5);
        else t.walk.wall(oa[0], oa[1], ob[0], ob[1], toa - 0.6, oa[0], oa[1], ob[0], ob[1], toa, 0.5);
        this.stats.walkSegments++;
      }
    }
  }

  private polesAndWires(road: RoadInfo, r: () => number) {
    const pts = road.pts, n = pts.length / 2;
    const nrm = this.normals(pts);
    const off = road.src.width / 2 + WALK - 0.25;
    const side = r() < 0.5 ? 1 : -1;
    let acc = 0, next = 8 + r() * 10;
    let prev: Pole | null = null;
    for (let i = 0; i < n - 1; i++) {
      const seg = Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
      if (acc + seg >= next) {
        const x = pts[2 * i] + nrm[i][0] * off * side, y = pts[2 * i + 1] + nrm[i][1] * off * side;
        next += 32 + r() * 6;
        if (!this.inTown(x, y) || this.onOtherRoad(road, x, y, 1)) { prev = null; acc += seg; continue; }
        const h = this.field.heightAt(x, y) + CURB + 0.1;
        const pole: Pole = { x, y, h, yaw: Math.atan2(nrm[i][1], nrm[i][0]) };
        const t = this.bucket(x, y);
        t.poles.push(pole);
        this.stats.poles++;
        if (prev && Math.hypot(prev.x - x, prev.y - y) < 45) this.wire(t, prev, pole);
        prev = pole;
      }
      acc += seg;
    }
  }

  /** Three sagging wires between two poles (catenary approximated by a parabola). */
  private wire(t: TileProps, a: Pole, b: Pole) {
    for (const o of [-0.75, 0, 0.75]) {
      const ax = a.x + Math.cos(a.yaw) * o, ay = a.y + Math.sin(a.yaw) * o;
      const bx = b.x + Math.cos(b.yaw) * o, by = b.y + Math.sin(b.yaw) * o;
      const ha = a.h + (o === 0 ? 8.5 : 7.97), hb = b.h + (o === 0 ? 8.5 : 7.97);
      const segs = 8;
      for (let s = 0; s < segs; s++) {
        const u0 = s / segs, u1 = (s + 1) / segs;
        const sag = (u: number) => 4 * 0.55 * u * (1 - u);
        t.wires.push(
          ax + (bx - ax) * u0, ha + (hb - ha) * u0 - sag(u0), -(ay + (by - ay) * u0),
          ax + (bx - ax) * u1, ha + (hb - ha) * u1 - sag(u1), -(ay + (by - ay) * u1),
        );
      }
    }
  }

  private topes(road: RoadInfo, r: () => number) {
    const pts = road.pts, n = pts.length / 2;
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
    if (total < 70) return;
    const w = road.src.width;
    let acc = 0, next = 25 + r() * 20;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
      const seg = Math.hypot(bx - ax, by - ay);
      if (acc + seg >= next && next < total - 25) {
        next += 100 + r() * 60;
        const t = (next - 100 - acc) / seg;
        void t;
        const x = (ax + bx) / 2, y = (ay + by) / 2;
        if (r() < 0.5 && this.inTown(x, y) && !this.onOtherRoad(road, x, y, 6)) this.addTope(road, x, y, (bx - ax) / seg, (by - ay) / seg, w);
      }
      acc += seg;
    }
  }

  /** Painted speed bump across the road: yellow and black stripes, 9 cm tall. */
  private addTope(road: RoadInfo, x: number, y: number, dx: number, dy: number, w: number) {
    const b = this.bucket(x, y).topes;
    const nx = -dy, ny = dx;
    const profile = [[-0.5, 0], [-0.22, 0.08], [0.22, 0.08], [0.5, 0]];
    const stripes = Math.round(w / 0.5);
    for (let s = 0; s < stripes; s++) {
      const c0 = -w / 2 + (w * s) / stripes, c1 = -w / 2 + (w * (s + 1)) / stripes;
      b.color(s % 2 ? '#1c1c1c' : '#f2c230');
      for (let k = 0; k < 3; k++) {
        const [a0, h0] = profile[k], [a1, h1] = profile[k + 1];
        const P = (along: number, across: number): [number, number] => [x + dx * along + nx * across, y + dy * along + ny * across];
        const [p0, p1, p2, p3] = [P(a0, c0), P(a0, c1), P(a1, c1), P(a1, c0)];
        const hb0 = this.roadH(road, p0[0], p0[1]) + 0.01;
        b.triUp(p0[0], p0[1], hb0 + h0, p1[0], p1[1], hb0 + h0, p2[0], p2[1], hb0 + h1);
        b.triUp(p0[0], p0[1], hb0 + h0, p2[0], p2[1], hb0 + h1, p3[0], p3[1], hb0 + h1);
      }
    }
    this.stats.topes++;
  }

  private parked(road: RoadInfo, r: () => number) {
    const pts = road.pts, n = pts.length / 2;
    const nrm = this.normals(pts);
    const hw = road.src.width / 2;
    if (road.src.width < 4.5) return;
    let acc = 0, next = 14;
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
    for (let i = 0; i < n - 1; i++) {
      const seg = Math.hypot(pts[2 * i + 2] - pts[2 * i], pts[2 * i + 3] - pts[2 * i + 1]);
      if (acc + seg >= next && next < total - 14) {
        next += 9 + r() * 22;
        const side = r() < 0.5 ? 1 : -1;
        const dx = (pts[2 * i + 2] - pts[2 * i]) / seg, dy = (pts[2 * i + 3] - pts[2 * i + 1]) / seg;
        if (r() < 0.45) {
          // half up on the curb, the way cars park on narrow town streets
          const off = hw + 0.25;
          const x = pts[2 * i] + nrm[i][0] * off * side, y = pts[2 * i + 1] + nrm[i][1] * off * side;
          // not on bends, where drivers cut the corner
          const a = Math.max(0, i - 2), b2 = Math.min(n - 1, i + 3);
          const d1x = pts[2 * i] - pts[2 * a], d1y = pts[2 * i + 1] - pts[2 * a + 1];
          const d2x = pts[2 * b2] - pts[2 * i], d2y = pts[2 * b2 + 1] - pts[2 * i + 1];
          const bend = Math.abs(Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y));
          // keep both ends of the car well clear of crossings
          const clear = !this.onOtherRoad(road, x, y, 6) && !this.onOtherRoad(road, x + dx * 2.2, y + dy * 2.2, 5) && !this.onOtherRoad(road, x - dx * 2.2, y - dy * 2.2, 5);
          if (this.inTown(x, y) && clear && bend < 0.17) {
            const flip = r() < 0.75 ? side : -side;   // most park facing the traffic flow
            const yaw = Math.atan2(-dx * flip, dy * flip);
            this.bucket(x, y).cars.push({ x, y, h: this.roadH(road, x, y) + 0.08, yaw, color: new THREE.Color(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]) });
            this.stats.cars++;
          }
        } else if (r() < 0.12) {
          const off = hw + WALK * 0.6;
          const x = pts[2 * i] + nrm[i][0] * off * side, y = pts[2 * i + 1] + nrm[i][1] * off * side;
          if (this.inTown(x, y) && !this.onOtherRoad(road, x, y, 1)) {
            this.bucket(x, y).dogs.push({ x, y, h: this.field.heightAt(x, y) + CURB, yaw: r() * Math.PI * 2, color: new THREE.Color(DOG_COLORS[Math.floor(r() * DOG_COLORS.length)]) });
            this.stats.dogs++;
          }
        }
      }
      acc += seg;
    }
  }

  build(tile: Tile) {
    const t = this.byTile.get(tile.key);
    if (!t) return;
    const owned: { dispose(): void }[] = [];
    if (t.walk.pos.length) {
      const m = t.walk.mesh(this.walkMat, false);
      tile.group.add(m);
      owned.push(m.geometry);
      tile.colliders.meshes.push(t.walk.collider());
    }
    if (t.topes.pos.length) {
      const m = t.topes.mesh(this.plainMat, false);
      tile.group.add(m);
      owned.push(m.geometry);
      tile.colliders.meshes.push(t.topes.collider());
    }
    if (t.wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(t.wires), 3));
      g.computeBoundingSphere();
      tile.group.add(new THREE.LineSegments(g, this.wireMat));
      owned.push(g);
    }
    const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const inst = <T extends { x: number; y: number; h: number; yaw: number; color?: THREE.Color }>(geo: THREE.BufferGeometry, list: T[], shadow: boolean) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, this.plainMat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((o, i) => {
        q.setFromAxisAngle(up, o.yaw);
        im.setMatrixAt(i, m.compose(new THREE.Vector3(o.x, o.h, -o.y), q, one));
        if (o.color) im.setColorAt(i, o.color);
      });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      tile.group.add(im);
      owned.push(im);
      return im;
    };
    inst(this.poleGeo, t.poles, true);
    inst(this.carGeo, t.cars, true);
    inst(this.dogGeo, t.dogs, false);
    for (const p of t.poles) tile.colliders.boxes.push({ x: p.x, y: p.h + 2, z: -p.y, hx: 0.15, hy: 2, hz: 0.15, yaw: 0 });
    for (const c of t.cars) tile.colliders.boxes.push({ x: c.x, y: c.h + 0.75, z: -c.y, hx: 0.88, hy: 0.7, hz: 2.1, yaw: c.yaw });
    const prev = tile.dispose;
    tile.dispose = () => { prev(); owned.forEach((o) => o.dispose()); };
  }
}
