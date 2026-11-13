import * as THREE from 'three';
import type { MapData, Ring } from '../data/types';
import type { Field, HeightModifier } from './field';
import { MeshBuilder, centroidOf, offsetRing, pointInRing, sdRing, segDistance, toCCW } from './geom';
import { stoneTexture, concreteTexture } from '../render/textures';

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

const MOAT = 11;          // moat width (m)
const WALL_H = 7;         // wall height above the plateau
const MOAT_DEPTH = 3.5;

/** 5x7 block font for the plaza sign. */
const GLYPHS: Record<string, string[]> = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};
const LETTER_COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#8338ec', '#06d6a0', '#ff006e'];

interface Fort { outline: Ring; cx: number; cy: number; base: number; courtyard: Ring; tips: [number, number][]; gate: { x: number; y: number; dx: number; dy: number } }
interface Plaza { ring: Ring; cx: number; cy: number; h: number }

/**
 * Procedural landmarks: Fuerte de San Felipe (star fort with moat), the central plaza
 * with the BACALAR letters, and terrain shaping for both. Piers live in PierLayer.
 */
export class Landmarks {
  fort: Fort | null = null;
  /** where the BACALAR letters stand and the direction they face (toward the fort) */
  signSpot: { x: number; y: number; h: number; nx: number; ny: number } | null = null;
  plaza: Plaza | null = null;
  readonly group = new THREE.Group();
  readonly colliders: { positions: Float32Array; indices: Uint32Array }[] = [];
  readonly boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }[] = [];
  private roadSegs: number[][] = [];

  constructor(private data: MapData) {
    const fortPoi = data.landmarks.find((l) => /san felipe/i.test(l.name) && l.ring && l.ring.length >= 8);
    if (fortPoi?.ring) {
      const outline = toCCW(fortPoi.ring);
      const [cx, cy] = centroidOf(outline);
      // bastion tips: vertices far from the center
      const dists: number[] = [];
      for (let k = 0; k < outline.length; k += 2) dists.push(Math.hypot(outline[k] - cx, outline[k + 1] - cy));
      const maxD = Math.max(...dists);
      const tips: [number, number][] = [];
      dists.forEach((d, i) => { if (d > maxD * 0.82) tips.push([outline[2 * i], outline[2 * i + 1]]); });
      // courtyard: square through points 42% of the way to each tip
      const sorted = tips.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
      const courtyard = sorted.flatMap(([x, y]) => [cx + (x - cx) * 0.42, cy + (y - cy) * 0.42]);
      this.fort = { outline, cx, cy, base: 0, courtyard: toCCW(courtyard), tips, gate: { x: 0, y: 0, dx: 1, dy: 0 } };
    }
    const park = data.parks.find((p) => /principal|central|zócalo|zocalo/i.test(p.name ?? '')) ?? data.parks[0];
    if (park) {
      const ring = toCCW(park.rings[0]);
      const [cx, cy] = centroidOf(ring);
      this.plaza = { ring, cx, cy, h: 0 };
    }
    // raw road segments near the fort (moat is not carved under roads)
    if (this.fort) {
      for (const r of data.roads) {
        if (r.cls === 'path') continue;
        for (let i = 0; i + 3 < r.pts.length; i += 2) {
          const mx = (r.pts[i] + r.pts[i + 2]) / 2, my = (r.pts[i + 1] + r.pts[i + 3]) / 2;
          if (Math.hypot(mx - this.fort.cx, my - this.fort.cy) < 220) this.roadSegs.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.width / 2 + 3]);
        }
      }
    }
  }

  private nearRoad(x: number, y: number) {
    for (const s of this.roadSegs) if (segDistance(x, y, s[0], s[1], s[2], s[3]) < s[4]) return true;
    return false;
  }

  /** Building / house exclusion circles. */
  exclusions() {
    const out: { x: number; y: number; r: number }[] = [];
    if (this.fort) out.push({ x: this.fort.cx, y: this.fort.cy, r: 45 + MOAT + 8 });
    if (this.plaza) {
      let r = 0;
      for (let k = 0; k < this.plaza.ring.length; k += 2) r = Math.max(r, Math.hypot(this.plaza.ring[k] - this.plaza.cx, this.plaza.ring[k + 1] - this.plaza.cy));
      out.push({ x: this.plaza.cx, y: this.plaza.cy, r: r + 4 });
    }
    return out;
  }

  /** Terrain shaping: flat fort plateau with a moat, flat plaza. Call before roads are built. */
  registerModifiers(field: Field) {
    const f = this.fort;
    if (f) {
      f.base = field.baseHeight(f.cx, f.cy);
      const outer = offsetRing(f.outline, MOAT + 30);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < outer.length; k += 2) { minX = Math.min(minX, outer[k]); maxX = Math.max(maxX, outer[k]); minY = Math.min(minY, outer[k + 1]); maxY = Math.max(maxY, outer[k + 1]); }
      const mod: HeightModifier = {
        minX, minY, maxX, maxY,
        apply: (x, y, h) => {
          const sd = sdRing(f.outline, x, y);
          if (sd < 0) return f.base;
          // roads keep their natural grade so the plateau does not create a dip for cars
          if (this.nearRoad(x, y)) return h;
          if (sd < MOAT && !this.nearRoad(x, y)) return f.base - MOAT_DEPTH;
          if (sd < MOAT + 30) return f.base + (h - f.base) * smooth((sd - Math.min(sd, MOAT)) / 30);
          return h;
        },
      };
      field.modifiers.push(mod);
    }
    const p = this.plaza;
    if (p) {
      p.h = field.baseHeight(p.cx, p.cy);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < p.ring.length; k += 2) { minX = Math.min(minX, p.ring[k]); maxX = Math.max(maxX, p.ring[k]); minY = Math.min(minY, p.ring[k + 1]); maxY = Math.max(maxY, p.ring[k + 1]); }
      field.modifiers.push({
        minX: minX - 20, minY: minY - 20, maxX: maxX + 20, maxY: maxY + 20,
        apply: (x, y, h) => {
          const sd = sdRing(p.ring, x, y);
          if (sd < 0) return p.h;
          return p.h + (h - p.h) * smooth(sd / 20);
        },
      });
    }
  }

  /** Keep trees and scattered houses off the landmarks. */
  markOccupied(field: Field) {
    if (this.fort) field.markPolygon(offsetRing(this.fort.outline, MOAT + 3), 2);
    if (this.plaza) field.markPolygon(this.plaza.ring, 1);
  }

  build(palmGeo: THREE.BufferGeometry, treeMat: THREE.Material) {
    if (this.fort) this.buildFort(this.fort);
    if (this.plaza) this.buildPlaza(this.plaza, palmGeo, treeMat);
  }

  // -------------------------------------------------------------------------

  private buildFort(f: Fort) {
    const stoneMat = new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true });
    const walls = new MeshBuilder().color('#fbf6ea');
    const top = f.base + WALL_H;
    const floor = f.base - MOAT_DEPTH - 0.3;
    // battered outer walls rising out of the moat
    walls.ringWalls(f.outline, floor, top, offsetRing(f.outline, 1.4));
    // parapet
    const inner = offsetRing(f.outline, -0.7);
    walls.color('#efe7d3');
    walls.ringWalls(f.outline, top, top + 1.1);
    walls.polygon(f.outline, [inner], top + 1.1);
    walls.ringWalls(toCW(inner), top, top + 1.1);
    // terreplein (walkway on top) with the courtyard cut out
    walls.color('#d9cfb6');
    walls.polygon(inner, [toCW(f.courtyard)], top);
    // courtyard walls facing inward
    walls.color('#fbf6ea');
    walls.ringWalls(toCW(f.courtyard), f.base - 0.2, top);
    // merlons along the parapet
    walls.color('#efe7d3');
    const n = f.outline.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = f.outline[2 * k], ay = f.outline[2 * k + 1], bx = f.outline[2 * k2], by = f.outline[2 * k2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const yaw = Math.atan2(by - ay, bx - ax);
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      for (let d = 1.5; d < len - 1; d += 3) {
        const x = ax + ((bx - ax) * d) / len - nx * 0.35, y = ay + ((by - ay) * d) / len - ny * 0.35;
        walls.box(x, y, top + 1.1, 0.6, 0.35, 0.6, yaw);
      }
    }
    const wallMesh = walls.mesh(stoneMat);
    this.group.add(wallMesh);
    this.colliders.push(walls.collider());

    // courtyard floor
    const yard = new MeshBuilder().color('#c9b98f');
    yard.polygon(f.courtyard, [], f.base + 0.05, 0.3);
    const yardMesh = yard.mesh(new THREE.MeshLambertMaterial({ map: concreteTexture(), vertexColors: true }), false);
    this.group.add(yardMesh);
    this.colliders.push(yard.collider());

    // garitas (sentry boxes) and cannons on each bastion tip
    const dark = new THREE.MeshLambertMaterial({ color: '#2b2b2b' });
    const garitaMat = new THREE.MeshLambertMaterial({ map: stoneTexture(), color: '#f1e9d6' });
    for (const [tx, ty] of f.tips) {
      const dx = tx - f.cx, dy = ty - f.cy, l = Math.hypot(dx, dy);
      const gx = tx - (dx / l) * 1.6, gy = ty - (dy / l) * 1.6;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 2.3, 10), garitaMat);
      body.position.set(gx, top + 1.15 + 0.05, -gy);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), garitaMat);
      dome.position.set(gx, top + 2.3, -gy);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), dark);
      slit.position.set(gx + (dx / l) * 0.8, top + 1.6, -(gy + (dy / l) * 0.8));
      body.castShadow = dome.castShadow = true;
      this.group.add(body, dome, slit);
      for (const side of [-1, 1]) {
        const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 8), dark);
        const px = gx - (dx / l) * 4 + (-dy / l) * side * 3, py = gy - (dy / l) * 4 + (dx / l) * side * 3;
        cannon.position.set(px, top + 0.6, -py);
        cannon.rotation.order = 'YXZ';
        cannon.rotation.y = Math.atan2(dx, dy) + Math.PI;
        cannon.rotation.x = Math.PI / 2 - 0.08;
        cannon.castShadow = true;
        this.group.add(cannon);
      }
    }

    // flag on the first bastion
    const [fx, fy] = f.tips[0] ?? [f.cx, f.cy];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 11, 6), new THREE.MeshLambertMaterial({ color: '#dddddd' }));
    const px = f.cx + (fx - f.cx) * 0.75, py = f.cy + (fy - f.cy) * 0.75;
    pole.position.set(px, top + 5.5, -py);
    this.group.add(pole);
    const fc = document.createElement('canvas');
    fc.width = 96; fc.height = 56;
    const g = fc.getContext('2d')!;
    g.fillStyle = '#006847'; g.fillRect(0, 0, 32, 56);
    g.fillStyle = '#ffffff'; g.fillRect(32, 0, 32, 56);
    g.fillStyle = '#ce1126'; g.fillRect(64, 0, 32, 56);
    g.fillStyle = '#8a5a2b'; g.beginPath(); g.arc(48, 28, 7, 0, Math.PI * 2); g.fill();
    const flagTex = new THREE.CanvasTexture(fc);
    flagTex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(px + 1.75, top + 9.9, -py);
    flag.name = 'flag';
    this.group.add(flag);

    // moat water and counterscarp
    const moatOuter = offsetRing(f.outline, MOAT);
    const cs = new MeshBuilder().color('#d8cdb3');
    const m = moatOuter.length / 2;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const ax = moatOuter[2 * k], ay = moatOuter[2 * k + 1], bx = moatOuter[2 * k2], by = moatOuter[2 * k2 + 1];
      // skip any wall piece that would cut across a road
      const segLen = Math.hypot(bx - ax, by - ay);
      let blocked = false;
      for (let d = 0; d <= segLen && !blocked; d += 0.75) blocked = this.nearRoad(ax + ((bx - ax) * d) / segLen, ay + ((by - ay) * d) / segLen);
      if (blocked) continue;
      // facing the fort: walk the edge backwards
      cs.wall(bx, by, ax, ay, floor, bx, by, ax, ay, f.base + 0.25);
    }
    this.group.add(cs.mesh(stoneMat));
    this.colliders.push(cs.collider());
    const water = new MeshBuilder().color('#ffffff');
    water.polygon(moatOuter, [toCW(offsetRing(f.outline, 1.4))], f.base - MOAT_DEPTH + 1.1);
    const waterMesh = water.mesh(new THREE.MeshStandardMaterial({ color: '#2f6f6a', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }), false);
    this.group.add(waterMesh);

    // wooden bridge and gate on the side facing the plaza (town)
    const towards = this.plaza ? [this.plaza.cx - f.cx, this.plaza.cy - f.cy] : [-1, 0];
    let best = 0, bestDot = -Infinity;
    const cn = f.courtyard.length / 2;
    for (let k = 0; k < cn; k++) {
      const k2 = (k + 1) % cn;
      const mx = (f.courtyard[2 * k] + f.courtyard[2 * k2]) / 2 - f.cx, my = (f.courtyard[2 * k + 1] + f.courtyard[2 * k2 + 1]) / 2 - f.cy;
      const dot = (mx * towards[0] + my * towards[1]) / (Math.hypot(mx, my) || 1);
      if (dot > bestDot) { bestDot = dot; best = k; }
    }
    const k2 = (best + 1) % cn;
    const mx = (f.courtyard[2 * best] + f.courtyard[2 * k2]) / 2, my = (f.courtyard[2 * best + 1] + f.courtyard[2 * k2 + 1]) / 2;
    const dirx = mx - f.cx, diry = my - f.cy, dl = Math.hypot(dirx, diry);
    const ux = dirx / dl, uy = diry / dl;
    // distance from the courtyard edge to the moat outer edge along the gate direction
    let reach = 0;
    while (reach < 80 && sdRing(moatOuter, mx + ux * reach, my + uy * reach) < 0) reach += 0.5;
    const wood = new THREE.MeshLambertMaterial({ color: '#7a5532' });
    const bridge = new MeshBuilder().color('#ffffff');
    const yaw = Math.atan2(uy, ux);
    bridge.box(mx + (ux * (reach + 2)) / 2, my + (uy * (reach + 2)) / 2, f.base + 0.05, (reach + 2) / 2, 1.7, 0.3, yaw);
    this.group.add(bridge.mesh(wood));
    this.colliders.push(bridge.collider());
    // gate arch cut visually as a dark opening on the outer wall
    let wallReach = 0;
    while (wallReach < 60 && sdRing(f.outline, mx + ux * wallReach, my + uy * wallReach) < 0) wallReach += 0.25;
    const gate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 3.2), new THREE.MeshLambertMaterial({ color: '#1e1a16' }));
    gate.position.set(mx + ux * (wallReach + 0.05), f.base + 1.8, -(my + uy * (wallReach + 0.05)));
    gate.rotation.y = yaw;
    this.group.add(gate);
    f.gate = { x: mx, y: my, dx: ux, dy: uy };
    // ramp up to the walkway inside the courtyard
    const ramp = new MeshBuilder().color('#d9cfb6');
    const rx = f.cx - ux * 4, ry = f.cy - uy * 4;
    const perpX = -uy, perpY = ux;
    const L = 16, W = 2.2;
    const startX = rx + perpX * 2, startY = ry + perpY * 2;
    const a0x = startX - perpX * W, a0y = startY - perpY * W;
    const b0x = startX + perpX * W, b0y = startY + perpY * W;
    const a1x = a0x - ux * L, a1y = a0y - uy * L, b1x = b0x - ux * L, b1y = b0y - uy * L;
    ramp.triUp(a0x, a0y, f.base + 0.05, b0x, b0y, f.base + 0.05, b1x, b1y, top);
    ramp.triUp(a0x, a0y, f.base + 0.05, b1x, b1y, top, a1x, a1y, top);
    this.group.add(ramp.mesh(new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true })));
    this.colliders.push(ramp.collider());
  }

  private buildPlaza(p: Plaza, palmGeo: THREE.BufferGeometry, treeMat: THREE.Material) {
    const paving = new MeshBuilder().color('#e3dccb');
    paving.polygon(p.ring, [], p.h + 0.14, 0.35);
    paving.color('#cfc6b0');
    paving.ringWalls(p.ring, p.h - 0.4, p.h + 0.14);
    const pave = paving.mesh(new THREE.MeshLambertMaterial({ map: concreteTexture(), vertexColors: true }), false);
    this.group.add(pave);
    this.colliders.push(paving.collider());

    // garden beds
    const beds = new MeshBuilder().color('#5f9a3a');
    const ringIn = offsetRing(p.ring, -7);
    for (let k = 0; k < ringIn.length; k += 2) {
      const x = p.cx + (ringIn[k] - p.cx) * 0.55, y = p.cy + (ringIn[k + 1] - p.cy) * 0.55;
      if (k % 4 === 0 && pointInRing(p.ring, x, y)) beds.box(x, y, p.h + 0.14, 3, 3, 0.25, Math.atan2(y - p.cy, x - p.cx));
    }
    this.group.add(beds.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }), false));

    // kiosk in the middle
    const kiosk = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: '#f7f3ea' });
    const roofMat = new THREE.MeshLambertMaterial({ color: '#c8643b' });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.9, 8), white);
    base.position.y = 0.45;
    kiosk.add(base);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.2, 8), white);
      col.position.set(Math.cos(a) * 4.6, 2.5, Math.sin(a) * 4.6);
      col.castShadow = true;
      kiosk.add(col);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.4, 8), roofMat);
    roof.position.y = 5.3;
    roof.castShadow = true;
    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 8), white);
    cupola.position.y = 6.8;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.9, 8), roofMat);
    cap.position.y = 7.7;
    kiosk.add(roof, cupola, cap);
    kiosk.position.set(p.cx, p.h + 0.14, -p.cy);
    this.group.add(kiosk);
    this.boxes.push({ x: p.cx, y: p.h + 0.6, z: -p.cy, hx: 5, hy: 0.5, hz: 5, yaw: 0 });

    // benches around the kiosk
    const benches = new MeshBuilder().color('#3f6b52');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 13;
      const x = p.cx + Math.cos(a) * r, y = p.cy + Math.sin(a) * r;
      if (!pointInRing(p.ring, x, y)) continue;
      benches.box(x, y, p.h + 0.14, 1.1, 0.3, 0.45, a + Math.PI / 2);
      benches.box(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, p.h + 0.59, 1.1, 0.05, 0.45, a + Math.PI / 2);
    }
    this.group.add(benches.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })));

    // palms
    const palmSpots: [number, number][] = [];
    for (let k = 0; k < p.ring.length; k += 4) {
      const x = p.cx + (p.ring[k] - p.cx) * 0.75, y = p.cy + (p.ring[k + 1] - p.cy) * 0.75;
      if (pointInRing(p.ring, x, y)) palmSpots.push([x, y]);
    }
    const palms = new THREE.InstancedMesh(palmGeo, treeMat, Math.max(1, palmSpots.length));
    palms.count = palmSpots.length;
    palmSpots.forEach(([x, y], i) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, p.h + 0.1, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7), new THREE.Vector3(1.1, 1.1, 1.1));
      palms.setMatrixAt(i, m);
    });
    palms.castShadow = true;
    palms.computeBoundingSphere();
    this.group.add(palms);

    // BACALAR letters on the plaza edge facing the fort
    const target = this.fort ? [this.fort.cx, this.fort.cy] : [p.cx + 50, p.cy];
    let ex = p.cx, ey = p.cy, bd = Infinity;
    for (let k = 0; k < p.ring.length; k += 2) {
      const d = Math.hypot(p.ring[k] - target[0], p.ring[k + 1] - target[1]);
      if (d < bd) { bd = d; ex = p.ring[k]; ey = p.ring[k + 1]; }
    }
    // pull the sign inside the plaza
    const fx = target[0] - p.cx, fy = target[1] - p.cy, fl = Math.hypot(fx, fy) || 1;
    const nx = fx / fl, ny = fy / fl;           // facing direction (toward the fort)
    const sx = p.cx + (ex - p.cx) * 0.78, sy = p.cy + (ey - p.cy) * 0.78;
    this.buildLetters('BACALAR', sx, sy, p.h + 0.14, nx, ny);
    this.signSpot = { x: sx, y: sy, h: p.h + 0.14, nx, ny };
  }

  private buildLetters(word: string, cx: number, cy: number, h: number, nx: number, ny: number) {
    const px = 0.34;                    // pixel size
    const letterW = 5 * px, gap = 0.45;
    const total = word.length * letterW + (word.length - 1) * gap;
    // reading direction: to the right when facing the sign (viewer looks along -n)
    const rx = -ny, ry = nx;
    const yaw = Math.atan2(ry, rx);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const b = new MeshBuilder();
    // plinth
    b.color('#f4f1ea');
    b.box(cx, cy, h, total / 2 + 0.6, 0.6, 0.35, yaw);
    [...word].forEach((ch, i) => {
      const glyph = GLYPHS[ch];
      b.color(LETTER_COLORS[i % LETTER_COLORS.length]);
      const offset = -total / 2 + i * (letterW + gap);
      glyph.forEach((row, r) => {
        for (let c = 0; c < 5; c++) {
          if (row[c] !== '1') continue;
          const along = offset + (c + 0.5) * px;
          const x = cx + rx * along, y = cy + ry * along;
          b.box(x, y, h + 0.35 + (6 - r) * px, px / 2, 0.22, px, yaw);
        }
      });
      const along = offset + letterW / 2;
      this.boxes.push({ x: cx + rx * along, y: h + 0.35 + 3.5 * px, z: -(cy + ry * along), hx: letterW / 2, hy: 3.5 * px, hz: 0.25, yaw });
    });
    const mesh = b.mesh(mat);
    this.group.add(mesh);
  }
}

function toCW(r: Ring): Ring {
  const ccw = toCCW(r);
  const out: number[] = [];
  for (let k = ccw.length - 2; k >= 0; k -= 2) out.push(ccw[k], ccw[k + 1]);
  return out;
}
