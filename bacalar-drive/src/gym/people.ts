import * as THREE from 'three';
import type { Field } from '../world/field';
import { LU_RESIDENTIAL } from '../world/field';
import type { RoadInfo, RoadNetwork } from '../world/roads';
import { BRAND, canvasTexture } from './brand';

/** Pedestrians strolling along the streets. Some want a ride to the gym. */

const matCache = new Map<string, THREE.MeshLambertMaterial>();
const mat = (c: string) => {
  let m = matCache.get(c);
  if (!m) matCache.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
  return m;
};
const box = (w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z);
  return m;
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const SKIN = ['#b07a52', '#a56d47', '#c48a5e', '#8f5e3b'];
const EMBROIDERY = ['#e63946', '#ff5fa2', '#2a9d8f', '#f4a261', '#8338ec', '#1d7fd1'];

export type Kind = 'senor' | 'senora' | 'joven' | 'paletero' | 'nino' | 'abuela' | 'gym';

export interface Figure { root: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; skirt: boolean }

export function figure(kind: Kind): Figure {
  const root = new THREE.Group();
  const skin = pick(SKIN);
  const limb = (w: number, h: number, c: string, x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.add(box(w, h, w + 0.02, c, 0, -h / 2, 0));
    root.add(g);
    return g;
  };
  let shirt = '#f4f1ea', pants = '#3b4a5a', skirt = false;
  const hair = '#1c1512';
  if (kind === 'senor') { shirt = '#fbfaf5'; pants = pick(['#c8b48a', '#6b5a45', '#3b4a5a']); }
  if (kind === 'joven') { shirt = pick(['#0b6b3a', '#d62828', '#1d7fd1', '#f4a261']); pants = pick(['#27323d', '#4a6fa5']); }
  if (kind === 'paletero') { shirt = '#ffffff'; pants = '#2d3e50'; }
  if (kind === 'nino') { shirt = pick(['#ffd23f', '#ff5fa2', '#43c9cb']); pants = '#3b4a5a'; }
  if (kind === 'gym') { shirt = BRAND.lime; pants = BRAND.charcoal; }
  if (kind === 'senora' || kind === 'abuela') skirt = true;

  const legs = [limb(0.15, 0.8, skirt ? skin : pants, -0.1, 0.82), limb(0.15, 0.8, skirt ? skin : pants, 0.1, 0.82)];
  const arms = [limb(0.11, 0.58, kind === 'gym' ? skin : shirt, -0.29, 1.42), limb(0.11, 0.58, kind === 'gym' ? skin : shirt, 0.29, 1.42)];
  root.add(box(0.44, 0.6, 0.25, shirt, 0, 1.16, 0));
  root.add(box(0.23, 0.26, 0.24, skin, 0, 1.62, 0));

  if (skirt) {
    // huipil: white dress with a band of bright embroidery, long skirt
    const band = pick(EMBROIDERY);
    root.add(box(0.5, 0.78, 0.34, kind === 'abuela' ? pick(['#7b2d43', '#2d5a7b', '#3f6b52']) : '#fbfaf5', 0, 0.62, 0));
    root.add(box(0.47, 0.12, 0.27, band, 0, 1.38, 0));
    root.add(box(0.52, 0.1, 0.36, band, 0, 0.3, 0));
    root.add(box(0.25, 0.1, 0.26, hair, 0, 1.78, 0));
    // braids
    root.add(box(0.06, 0.4, 0.06, hair, -0.14, 1.45, -0.12));
    root.add(box(0.06, 0.4, 0.06, hair, 0.14, 1.45, -0.12));
    if (kind === 'abuela') root.add(box(0.5, 0.22, 0.3, pick(EMBROIDERY), 0, 1.36, 0.01)); // rebozo
  } else if (kind === 'senor' || kind === 'paletero') {
    // straw sombrero and moustache
    root.add(box(0.62, 0.035, 0.62, '#e2c98f', 0, 1.77, 0));
    root.add(box(0.28, 0.16, 0.28, '#e2c98f', 0, 1.86, 0));
    root.add(box(0.29, 0.03, 0.29, '#7a4a2a', 0, 1.8, 0));
    root.add(box(0.14, 0.035, 0.03, hair, 0, 1.57, -0.125));
    if (kind === 'senor') { root.add(box(0.03, 0.5, 0.01, '#d8d2c4', -0.09, 1.16, -0.13)); root.add(box(0.03, 0.5, 0.01, '#d8d2c4', 0.09, 1.16, -0.13)); }
  } else if (kind === 'gym') {
    root.add(box(0.25, 0.08, 0.26, hair, 0, 1.78, 0));
    root.add(box(0.3, 0.08, 0.1, '#ffffff', 0, 1.47, 0.05)); // towel on the shoulders
    root.add(box(0.46, 0.22, 0.26, BRAND.charcoal, 0, 0.78, 0));
  } else {
    root.add(box(0.25, 0.08, 0.26, hair, 0, 1.78, 0));
    root.add(box(0.26, 0.07, 0.3, kind === 'nino' ? '#d62828' : '#20252a', 0, 1.81, -0.04)); // cap
  }
  if (kind === 'paletero') {
    // paleta cart with a striped umbrella
    const cart = new THREE.Group();
    cart.add(box(0.7, 0.55, 1.0, '#ffffff', 0, 0.62, 0));
    cart.add(box(0.72, 0.08, 1.02, '#43c9cb', 0, 0.92, 0));
    cart.add(box(0.04, 1.3, 0.04, '#888', 0, 1.55, 0));
    const umb = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 8), mat('#ff5fa2'));
    umb.position.y = 2.3;
    cart.add(umb);
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), mat('#222'));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(s * 0.38, 0.2, 0.1);
      cart.add(wheel);
    }
    cart.position.set(0, 0, -0.85);
    root.add(cart);
  }
  if (kind === 'nino') root.scale.setScalar(0.68);
  root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  return { root, legs, arms, skirt };
}

function markerTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = BRAND.lime;
  g.beginPath(); g.roundRect(8, 8, 240, 104, 28); g.fill();
  g.beginPath(); g.moveTo(108, 110); g.lineTo(128, 152); g.lineTo(148, 110); g.fill();
  g.fillStyle = BRAND.charcoal;
  g.font = '900 46px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('¡AL GYM!', 128, 62);
  return canvasTexture(c);
}

interface Npc {
  fig: Figure;
  kind: Kind;
  road: RoadInfo;
  /** distance along the road polyline (m) */
  s: number;
  dir: number;
  side: number;
  speed: number;
  phase: number;
  wantsGym: boolean;
  marker?: THREE.Sprite;
  x: number; y: number;
  /** walk: strolling; fly: knocked into the air; down: lying after a hit; board: running to the car; leave: walking into the gym */
  state: 'walk' | 'fly' | 'down' | 'board' | 'leave';
  /** height above ground while flying, and velocities (map coords, m/s) */
  hz: number; vx: number; vy: number; vz: number;
  spin: THREE.Vector3; bounces: number; timer: number;
  /** target for 'leave' */
  tx?: number; ty?: number;
}

/** What the player's vehicle looks like to pedestrians this frame. */
export interface CarState {
  x: number; y: number; h: number;
  vx: number; vy: number;
  /** heading (radians clockwise from north) and half sizes of the body footprint */
  heading: number; halfW: number; halfL: number;
  speed: number;
  /** free seats for gym-goers, 0 when none or not stopped */
  freeSeats: number;
  stopped: boolean;
}

export interface PeopleEvents {
  hits: { speed: number; kind: Kind; x: number; y: number; gymGoer: boolean }[];
  boarded: Kind[];
  bounces: number[];
}

export class People {
  readonly group = new THREE.Group();
  private npcs: Npc[] = [];
  private markerMat = new THREE.SpriteMaterial({ map: markerTexture(), depthWrite: false });
  private lengths = new Map<RoadInfo, number[]>();
  private spawnTimer = 0;
  max = 34;

  constructor(private roads: RoadNetwork, private field: Field) {}

  private cum(r: RoadInfo) {
    let c = this.lengths.get(r);
    if (!c) {
      c = [0];
      for (let i = 2; i < r.pts.length; i += 2) c.push(c[c.length - 1] + Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]));
      this.lengths.set(r, c);
    }
    return c;
  }

  /** Position and direction at distance s along a road. */
  private at(r: RoadInfo, s: number) {
    const c = this.cum(r);
    let i = 0;
    while (i < c.length - 2 && c[i + 1] < s) i++;
    const seg = c[i + 1] - c[i] || 1;
    const t = Math.max(0, Math.min(1, (s - c[i]) / seg));
    const ax = r.pts[2 * i], ay = r.pts[2 * i + 1], bx = r.pts[2 * i + 2], by = r.pts[2 * i + 3];
    const dx = (bx - ax) / seg, dy = (by - ay) / seg;
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx, dy };
  }

  private spawn(fx: number, fy: number, gymShare: number) {
    const segs = this.roads.segmentsNear(fx, fy, 150);
    for (let tries = 0; tries < 12 && segs.length; tries++) {
      const sg = pick(segs);
      const cls = sg.road.src.cls;
      if (cls === 'track' || cls === 'primary') continue;
      const mx = (sg.ax + sg.bx) / 2, my = (sg.ay + sg.by) / 2;
      const d = Math.hypot(mx - fx, my - fy);
      if (d < 45 || d > 150) continue;
      const inTown = this.field.landuseAt(mx, my) === LU_RESIDENTIAL || cls === 'path';
      if (!inTown && Math.random() > 0.15) continue;
      const c = this.cum(sg.road);
      const total = c[c.length - 1];
      if (total < 12) continue;
      // locate the segment on its road
      let s = 0, bd = Infinity;
      for (let i = 0; i < c.length; i++) {
        const dd = (sg.road.pts[2 * i] - mx) ** 2 + (sg.road.pts[2 * i + 1] - my) ** 2;
        if (dd < bd) { bd = dd; s = c[i]; }
      }
      const wantsGym = Math.random() < gymShare;
      const kind: Kind = wantsGym ? 'gym' : pick<Kind>(['senor', 'senor', 'senora', 'senora', 'abuela', 'joven', 'joven', 'paletero', 'nino']);
      const fig = figure(kind);
      const npc: Npc = {
        fig, kind, road: sg.road, s, dir: Math.random() < 0.5 ? 1 : -1, side: Math.random() < 0.5 ? 1 : -1,
        speed: kind === 'abuela' ? 0.75 : kind === 'paletero' ? 0.9 : kind === 'gym' ? 1.6 : 1.1 + Math.random() * 0.4,
        phase: Math.random() * 6, wantsGym, x: mx, y: my,
        state: 'walk', hz: 0, vx: 0, vy: 0, vz: 0, spin: new THREE.Vector3(), bounces: 0, timer: 0,
      };
      if (wantsGym) {
        npc.marker = new THREE.Sprite(this.markerMat);
        npc.marker.scale.set(2.4, 1.5, 1);
        npc.marker.position.y = 3.1;
        npc.marker.layers.set(1);
        fig.root.add(npc.marker);
      }
      this.group.add(fig.root);
      this.npcs.push(npc);
      return;
    }
  }

  private remove(n: Npc) {
    this.group.remove(n.fig.root);
    this.npcs.splice(this.npcs.indexOf(n), 1);
  }

  private groundH(x: number, y: number, n: Npc) {
    const onWalk = n.road.src.cls !== 'path' && n.road.src.paved && this.field.landuseAt(x, y) === LU_RESIDENTIAL;
    return this.field.heightAt(x, y) + (onWalk ? 0.32 : 0.12);
  }

  /** Gym members walking from the car into the gym after a drop-off. */
  spawnLeaving(kinds: Kind[], fromX: number, fromY: number, toX: number, toY: number) {
    kinds.forEach((kind, i) => {
      const fig = figure(kind);
      const road = this.roads.nearest(fromX, fromY, 60)?.road;
      if (!road) return;
      const n: Npc = {
        fig, kind, road, s: 0, dir: 1, side: 1, speed: 1.8, phase: i, wantsGym: false,
        x: fromX + (i - 1) * 0.9, y: fromY + (i % 2) * 0.8, state: 'leave', hz: 0, vx: 0, vy: 0, vz: 0,
        spin: new THREE.Vector3(), bounces: 0, timer: 6, tx: toX, ty: toY,
      };
      this.group.add(fig.root);
      this.npcs.push(n);
    });
  }

  private animateWalk(n: Npc, time: number, speed: number) {
    const sw = Math.sin(time * (4 + speed * 3) + n.phase) * (n.fig.skirt ? 0.25 : 0.55) * Math.min(1, speed);
    n.fig.legs[0].rotation.x = sw; n.fig.legs[1].rotation.x = -sw;
    if (n.kind === 'paletero' && n.state === 'walk') { n.fig.arms[0].rotation.x = n.fig.arms[1].rotation.x = -1.2; }
    else { n.fig.arms[0].rotation.x = -sw * 0.8; n.fig.arms[1].rotation.x = sw * 0.8; }
  }

  /** Is the point inside the car body footprint (with a margin)? */
  private touches(car: CarState, x: number, y: number, margin: number) {
    const dx = x - car.x, dy = y - car.y;
    const fx = Math.sin(car.heading), fy = Math.cos(car.heading);
    const along = dx * fx + dy * fy, across = dx * fy - dy * fx;
    return Math.abs(along) < car.halfL + margin && Math.abs(across) < car.halfW + margin;
  }

  update(dt: number, time: number, fx: number, fy: number, car: CarState | null): PeopleEvents {
    const ev: PeopleEvents = { hits: [], boarded: [], bounces: [] };
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.npcs.length < this.max) {
      this.spawnTimer = 0.15;
      const waiting = this.npcs.filter((n) => n.wantsGym).length;
      this.spawn(fx, fy, waiting < 5 ? 0.3 : 0.05);
    }
    let seats = car?.freeSeats ?? 0;
    for (const n of this.npcs.slice()) {
      const root = n.fig.root;
      if (n.state === 'fly') {
        // ballistic flight with tumbling, bouncing on the ground
        n.vz -= 18 * dt;
        n.x += n.vx * dt; n.y += n.vy * dt; n.hz += n.vz * dt;
        root.rotation.x += n.spin.x * dt; root.rotation.z += n.spin.z * dt; root.rotation.y += n.spin.y * dt;
        if (n.hz <= 0) {
          n.hz = 0;
          if (n.bounces < 2 && n.vz < -3) {
            ev.bounces.push(Math.min(1, -n.vz / 12));
            n.vz = -n.vz * 0.42; n.vx *= 0.55; n.vy *= 0.55; n.spin.multiplyScalar(0.5); n.bounces++;
          } else {
            n.state = 'down'; n.timer = 1.6; n.vx = n.vy = n.vz = 0;
            root.rotation.set(-Math.PI / 2, root.rotation.y, 0);
          }
        }
        root.position.set(n.x, this.field.heightAt(n.x, n.y) + 0.15 + n.hz, -n.y);
        continue;
      }
      if (n.state === 'down') {
        n.timer -= dt;
        root.position.set(n.x, this.field.heightAt(n.x, n.y) + 0.25, -n.y);
        if (n.timer < 0.5) root.rotation.x = -Math.PI / 2 * Math.max(0, n.timer / 0.5); // gets back up
        if (n.timer <= 0) {
          root.rotation.set(0, root.rotation.y, 0);
          // walk away along the nearest street, a little dizzy
          const r = this.roads.nearest(n.x, n.y, 40, (o) => o.src.cls !== 'track');
          if (!r) { this.remove(n); continue; }
          const c = this.cum(r.road);
          let s = 0, bd = Infinity;
          for (let i = 0; i < c.length; i++) {
            const d = (r.road.pts[2 * i] - r.x) ** 2 + (r.road.pts[2 * i + 1] - r.y) ** 2;
            if (d < bd) { bd = d; s = c[i]; }
          }
          n.road = r.road; n.s = s; n.state = 'walk'; n.speed *= 1.3;
        }
        continue;
      }
      if (n.state === 'leave') {
        const dx = n.tx! - n.x, dy = n.ty! - n.y, d = Math.hypot(dx, dy);
        n.timer -= dt;
        if (d < 1 || n.timer <= 0) { this.remove(n); continue; }
        n.x += (dx / d) * n.speed * dt; n.y += (dy / d) * n.speed * dt;
        root.position.set(n.x, this.field.heightAt(n.x, n.y) + 0.15, -n.y);
        root.rotation.set(0, Math.atan2(-dx, dy), 0);
        this.animateWalk(n, time, n.speed);
        continue;
      }

      // knocked over by the car?
      if (car && car.speed > 3 && this.touches(car, n.x, n.y, 0.6)) {
        const sp = car.speed;
        const fwdX = Math.sin(car.heading), fwdY = Math.cos(car.heading);
        // thrown forward and a bit sideways, away from the car's center line
        const side = Math.sign((n.x - car.x) * fwdY - (n.y - car.y) * fwdX) || (Math.random() < 0.5 ? -1 : 1);
        n.vx = car.vx * 1.2 + fwdY * side * sp * 0.25;
        n.vy = car.vy * 1.2 - fwdX * side * sp * 0.25;
        n.vz = 4 + sp * 0.32;
        n.hz = 0.3;
        n.spin.set((Math.random() * 2 - 1) * 12, (Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 12);
        n.state = 'fly'; n.bounces = 0;
        if (n.marker) { root.remove(n.marker); n.marker = undefined; }
        const wasGym = n.wantsGym;
        n.wantsGym = false;
        ev.hits.push({ speed: sp, kind: n.kind, x: n.x, y: n.y, gymGoer: wasGym });
        continue;
      }

      // a gym-goer runs to the stopped car and climbs aboard
      if (n.wantsGym && car && car.stopped && seats > 0 && Math.hypot(n.x - car.x, n.y - car.y) < 16) {
        n.state = 'board';
        seats--;
      }
      if (n.state === 'board') {
        if (!car || !car.stopped || car.freeSeats <= 0) { n.state = 'walk'; }
        else {
          // aim for the side door
          const fwdX = Math.sin(car.heading), fwdY = Math.cos(car.heading);
          const sx = (n.x - car.x) * fwdY - (n.y - car.y) * fwdX >= 0 ? 1 : -1;
          const tx = car.x + fwdY * sx * (car.halfW + 0.6), ty = car.y - fwdX * sx * (car.halfW + 0.6);
          const dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy);
          if (d < 0.6) {
            ev.boarded.push(n.kind);
            this.remove(n);
            continue;
          }
          const run = 4.2;
          n.x += (dx / d) * Math.min(d, run * dt); n.y += (dy / d) * Math.min(d, run * dt);
          root.position.set(n.x, this.groundH(n.x, n.y, n) , -n.y);
          root.rotation.set(0, Math.atan2(-dx, dy), 0);
          this.animateWalk(n, time, run);
          if (n.marker) n.marker.position.y = 3.1 + Math.sin(time * 9) * 0.25;
          continue;
        }
      }

      // stroll along the street
      const c = this.cum(n.road);
      const total = c[c.length - 1];
      n.s += n.dir * n.speed * dt;
      if (n.s < 1) { n.s = 1; n.dir = 1; n.side = -n.side; }
      if (n.s > total - 1) { n.s = total - 1; n.dir = -1; n.side = -n.side; }
      const p = this.at(n.road, n.s);
      const walkway = n.road.src.cls === 'path' ? 0.4 : n.road.src.width / 2 + 1.35;
      const wx = p.x - p.dy * walkway * n.side, wy = p.y + p.dx * walkway * n.side;
      // after being knocked over they ease back onto the sidewalk instead of teleporting
      const k = Math.min(1, dt * 2.5);
      n.x += (wx - n.x) * k; n.y += (wy - n.y) * k;
      const d = Math.hypot(n.x - fx, n.y - fy);
      if (d > 190 || this.field.shoreDist(n.x, n.y) < 0.5) { this.remove(n); continue; }
      root.position.set(n.x, this.groundH(n.x, n.y, n), -n.y);
      // forward of the figure is -Z
      root.rotation.set(0, Math.atan2(-p.dx * n.dir, p.dy * n.dir), 0);
      this.animateWalk(n, time, n.speed);
      if (n.marker) n.marker.position.y = 3.1 + Math.sin(time * 4 + n.phase) * 0.15;
    }
    return ev;
  }

  /** Map positions of people waiting for a ride (for the minimap). */
  waiting() { return this.npcs.filter((n) => n.wantsGym && (n.state === 'walk' || n.state === 'board')).map((n) => [n.x, n.y] as [number, number]); }
  count() { return this.npcs.length; }
}
