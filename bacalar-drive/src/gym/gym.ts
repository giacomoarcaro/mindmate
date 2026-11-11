import * as THREE from 'three';
import type { MapData } from '../data/types';
import { makeProjection } from '../data/projection';
import type { Field } from '../world/field';
import type { RoadNetwork } from '../world/roads';
import { segDistance } from '../world/geom';
import { BRAND, canvasTexture, drawBillboard, drawLogo, drawSign } from './brand';

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/**
 * The Bacalar Jungle Gym itself, placed at its real coordinates: building with signage,
 * a light beacon visible across town, the drop-off zone and roadside billboards.
 */
export class GymSite {
  /** building center (map coords) */
  readonly x: number;
  readonly y: number;
  /** drop-off zone center, between the road and the entrance */
  readonly dropX: number;
  readonly dropY: number;
  /** unit vector from the building toward its street */
  readonly ux: number;
  readonly uy: number;
  h = 15;
  readonly group = new THREE.Group();
  readonly boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }[] = [];
  private ring!: THREE.Mesh;
  private beacon!: THREE.Mesh;
  private roofLogo!: THREE.Object3D;
  private signMat!: THREE.MeshBasicMaterial;
  readonly W = 18;
  readonly D = 15;
  readonly H = 6.5;

  constructor(data: MapData) {
    const proj = makeProjection(data.meta.origin.lat, data.meta.origin.lon);
    const [gx, gy] = proj.toLocal(BRAND.lat, BRAND.lon);
    // nearest drivable street in the raw data
    let best = { d: Infinity, x: gx, y: gy + 10, w: 5 };
    for (const r of data.roads) {
      if (r.cls === 'path') continue;
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
        const d = segDistance(gx, gy, ax, ay, bx, by);
        if (d < best.d) {
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / l2));
          best = { d, x: ax + t * dx, y: ay + t * dy, w: r.width };
        }
      }
    }
    let ux = best.x - gx, uy = best.y - gy;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    this.ux = ux; this.uy = uy;
    const front = best.w / 2 + 7;               // road edge to facade
    this.x = best.x - ux * (front + this.D / 2);
    this.y = best.y - uy * (front + this.D / 2);
    this.dropX = best.x - ux * (best.w / 2 + 3.5);
    this.dropY = best.y - uy * (best.w / 2 + 3.5);
  }

  exclusion() { return { x: this.x, y: this.y, r: 24 }; }

  registerModifier(field: Field) {
    this.h = field.baseHeight(this.x, this.y);
    field.modifiers.push({
      minX: this.x - 60, maxX: this.x + 60, minY: this.y - 60, maxY: this.y + 60,
      apply: (x, y, h) => {
        const d = Math.hypot(x - this.x, y - this.y);
        return d < 28 ? this.h : this.h + (h - this.h) * smooth((d - 28) / 25);
      },
    });
  }

  markOccupied(field: Field) {
    const r = 20;
    field.markPolygon([this.x - r, this.y - r, this.x + r, this.y - r, this.x + r, this.y + r, this.x - r, this.y + r], 3);
  }

  build() {
    const g = new THREE.Group();
    const { W, D, H } = this;
    const lime = new THREE.MeshLambertMaterial({ color: BRAND.lime });
    const dark = new THREE.MeshLambertMaterial({ color: BRAND.charcoal });
    const pink = new THREE.MeshLambertMaterial({ color: BRAND.pink });
    const glass = new THREE.MeshStandardMaterial({ color: '#1c3b3a', roughness: 0.15, metalness: 0.4, emissive: '#b4e23c', emissiveIntensity: 0.05 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow; m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // local frame: +Z faces the street
    add(new THREE.BoxGeometry(W, H, D), lime, 0, H / 2, 0);
    add(new THREE.BoxGeometry(W + 0.3, 0.9, D + 0.3), dark, 0, 0.45, 0);
    add(new THREE.BoxGeometry(W + 0.4, 0.5, D + 0.4), dark, 0, H + 0.25, 0);
    // glass front and door
    add(new THREE.BoxGeometry(W - 3, 2.9, 0.2), glass, 0, 2.35, D / 2 + 0.02, false);
    add(new THREE.BoxGeometry(2.6, 0.25, 2.6), pink, 0, 3.95, D / 2 + 1.3);
    // facade sign
    this.signMat = new THREE.MeshBasicMaterial({ map: canvasTexture(drawSign(1024, 256, BRAND.offer)) });
    add(new THREE.PlaneGeometry(W - 2, (W - 2) / 4), this.signMat, 0, H - 1.25, D / 2 + 0.12, false);
    // side murals
    const logoTex = canvasTexture(drawLogo(512));
    const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true });
    for (const s of [-1, 1]) {
      const m = add(new THREE.PlaneGeometry(5, 5), logoMat, s * (W / 2 + 0.06), H / 2 + 0.3, 0, false);
      m.rotation.y = s * Math.PI / 2;
    }
    // rotating logo on the roof
    const roof = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, side: THREE.DoubleSide }));
    const back = disc.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.02;
    roof.add(disc, back);
    roof.position.set(0, H + 4.6, 0);
    add(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), dark, 0, H + 0.9, 0);
    g.add(roof);
    this.roofLogo = roof;
    // outdoor rig: pull-up bars and a barbell, so it reads as a gym from the street
    for (const sx of [-6.5, -4.2]) add(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), dark, sx, 1.3, D / 2 + 3.2);
    const bar = add(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), dark, -5.35, 2.55, D / 2 + 3.2);
    bar.rotation.z = Math.PI / 2;
    const bb = add(new THREE.CylinderGeometry(0.04, 0.04, 2, 8), new THREE.MeshLambertMaterial({ color: '#c9c9c9' }), 5.6, 0.38, D / 2 + 3);
    bb.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      const plate = add(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 16), pink, 5.6 + s * 0.85, 0.38, D / 2 + 3);
      plate.rotation.z = Math.PI / 2;
    }
    // drop-off ring on the forecourt
    const ringMat = new THREE.MeshBasicMaterial({ color: BRAND.lime, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.4, 40).rotateX(-Math.PI / 2), ringMat);
    g.add(this.ring);
    // beacon: a soft column of light, visible from across town
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.6, 260, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: BRAND.lime, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beacon.position.set(0, H + 130, 0);
    this.beacon.renderOrder = 4;
    g.add(this.beacon);

    const yaw = Math.atan2(this.ux, -this.uy);
    g.position.set(this.x, this.h, -this.y);
    g.rotation.y = yaw;
    this.ring.position.set(0, 0.25, 0);
    // ring in world space: move from building center toward the street
    const toDrop = Math.hypot(this.dropX - this.x, this.dropY - this.y);
    this.ring.position.z = toDrop;
    this.group.add(g);
    this.boxes.push({ x: this.x, y: this.h + H / 2, z: -this.y, hx: W / 2, hy: H / 2, hz: D / 2, yaw });
  }

  /** Billboards on the main roads pointing drivers to the gym. */
  buildBillboards(roads: RoadNetwork, field: Field, max = 16) {
    const textures = new Map<string, THREE.Texture>();
    const pole = new THREE.MeshLambertMaterial({ color: '#555b60' });
    let count = 0;
    for (const r of roads.roads) {
      if (r.src.cls !== 'primary' && r.src.cls !== 'secondary') continue;
      let acc = 0, next = 180;
      for (let i = 0; i + 3 < r.pts.length && count < max; i += 2) {
        const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
        const seg = Math.hypot(bx - ax, by - ay);
        if (next < acc + seg) {
          next += 650;
          const dx = (bx - ax) / seg, dy = (by - ay) / seg;
          const off = r.src.width / 2 + 5;
          const x = ax - dy * off, y = ay + dx * off;
          const dist = Math.hypot(x - this.x, y - this.y);
          if (field.shoreDist(x, y) < 6 || dist < 60) { acc += seg; continue; }
          const other = roads.nearest(x, y, 12, (o) => o !== r);
          if (other && other.dist < other.road.src.width / 2 + 3) { acc += seg; continue; }
          const label = dist < 950 ? `a ${Math.round(dist / 50) * 50} m` : `a ${(dist / 1000).toFixed(1)} km`;
          let tex = textures.get(label);
          if (!tex) textures.set(label, (tex = canvasTexture(drawBillboard(label))));
          const mat = new THREE.MeshBasicMaterial({ map: tex });
          const bg = new THREE.Group();
          for (const s of [-1, 1]) {
            const face = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), mat);
            face.position.set(0, 7, s * 0.12);
            face.rotation.y = s > 0 ? 0 : Math.PI;
            bg.add(face);
          }
          const frame = new THREE.Mesh(new THREE.BoxGeometry(9.3, 4.8, 0.18), pole);
          frame.position.y = 7;
          frame.castShadow = true;
          bg.add(frame);
          for (const sx of [-3, 3]) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5, 8), pole);
            p.position.set(sx, 2.5, 0);
            p.castShadow = true;
            bg.add(p);
          }
          bg.position.set(x, field.heightAt(x, y), -y);
          // faces look along the road so drivers in both directions read it
          bg.rotation.y = Math.atan2(dx, -dy);
          this.group.add(bg);
          count++;
        }
        acc += seg;
      }
    }
    return count;
  }

  update(time: number, night: number) {
    const s = 1 + Math.sin(time * 3) * 0.08;
    this.ring.scale.set(s, 1, s);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 3) * 0.25;
    this.roofLogo.rotation.y = time * 0.6;
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.12 + night * 0.3;
  }

  /** Distance from a map point to the drop-off zone. */
  dropDistance(x: number, y: number) { return Math.hypot(x - this.dropX, y - this.dropY); }
}
