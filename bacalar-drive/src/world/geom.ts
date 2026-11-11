import * as THREE from 'three';
import type { Ring } from '../data/types';

/** Small helpers for building merged static meshes in map coordinates (x east, y north, h up). */

export function signedArea(r: Ring) {
  let a = 0;
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    a += r[2 * k] * r[2 * k2 + 1] - r[2 * k2] * r[2 * k + 1];
  }
  return a / 2;
}

export function toCCW(r: Ring): Ring {
  if (signedArea(r) >= 0) return r.slice();
  const out: number[] = [];
  for (let k = r.length - 2; k >= 0; k -= 2) out.push(r[k], r[k + 1]);
  return out;
}

export function centroidOf(r: Ring): [number, number] {
  let x = 0, y = 0;
  for (let k = 0; k < r.length; k += 2) { x += r[k]; y += r[k + 1]; }
  return [x / (r.length / 2), y / (r.length / 2)];
}

export function pointInRing(r: Ring, x: number, y: number) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

/** Signed distance to a polygon (negative inside). */
export function sdRing(r: Ring, x: number, y: number) {
  let d = Infinity;
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    d = Math.min(d, segDistance(x, y, r[2 * k], r[2 * k + 1], r[2 * k2], r[2 * k2 + 1]));
  }
  return pointInRing(r, x, y) ? -d : d;
}

/** Offsets a CCW ring outward by `d` (negative = inward) using mitered vertices. */
export function offsetRing(r: Ring, d: number, miterLimit = 3): Ring {
  const n = r.length / 2;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = (k + n - 1) % n, q = (k + 1) % n;
    const x = r[2 * k], y = r[2 * k + 1];
    let e1x = x - r[2 * p], e1y = y - r[2 * p + 1];
    let e2x = r[2 * q] - x, e2y = r[2 * q + 1] - y;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // outward normals of a CCW ring are to the right of the edge direction
    const n1x = e1y, n1y = -e1x, n2x = e2y, n2y = -e2x;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = mx * n1x + my * n1y;
    const s = Math.min(miterLimit, 1 / Math.max(0.2, cos));
    out.push(x + mx * d * s, y + my * d * s);
  }
  return out;
}

export class MeshBuilder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private c = new THREE.Color(1, 1, 1);

  color(c: THREE.ColorRepresentation) { this.c.set(c); return this; }

  private v(x: number, y: number, h: number, u: number, w: number) {
    this.pos.push(x, h, -y);
    this.uv.push(u, w);
    this.col.push(this.c.r, this.c.g, this.c.b);
  }

  /** Triangle given in map coords, oriented to face up (for horizontal surfaces). */
  triUp(ax: number, ay: number, ah: number, bx: number, by: number, bh: number, cx: number, cy: number, ch: number, uvScale = 0.25) {
    const ux = bx - ax, uz = -(by - ay), vx = cx - ax, vz = -(cy - ay);
    if (uz * vx - ux * vz >= 0) {
      this.v(ax, ay, ah, ax * uvScale, ay * uvScale); this.v(bx, by, bh, bx * uvScale, by * uvScale); this.v(cx, cy, ch, cx * uvScale, cy * uvScale);
    } else {
      this.v(ax, ay, ah, ax * uvScale, ay * uvScale); this.v(cx, cy, ch, cx * uvScale, cy * uvScale); this.v(bx, by, bh, bx * uvScale, by * uvScale);
    }
  }

  /** Quad from bottom edge (a0, b0) to top edge (a1, b1) facing to the right of a -> b. */
  wall(ax0: number, ay0: number, bx0: number, by0: number, h0: number, ax1: number, ay1: number, bx1: number, by1: number, h1: number, uvScale = 0.25) {
    const len = Math.hypot(bx0 - ax0, by0 - ay0) * uvScale;
    const v0 = h0 * uvScale, v1 = h1 * uvScale;
    this.v(ax0, ay0, h0, 0, v0); this.v(bx0, by0, h0, len, v0); this.v(bx1, by1, h1, len, v1);
    this.v(ax0, ay0, h0, 0, v0); this.v(bx1, by1, h1, len, v1); this.v(ax1, ay1, h1, 0, v1);
  }

  /** Extrude the sides of a ring (CCW faces out, CW faces in) between two heights, optional batter. */
  ringWalls(r: Ring, h0: number, h1: number, rBottom: Ring = r, uvScale = 0.25) {
    const n = r.length / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      this.wall(rBottom[2 * k], rBottom[2 * k + 1], rBottom[2 * k2], rBottom[2 * k2 + 1], h0,
        r[2 * k], r[2 * k + 1], r[2 * k2], r[2 * k2 + 1], h1, uvScale);
    }
  }

  /** Flat polygon (with optional holes) at height h. */
  polygon(outer: Ring, holes: Ring[], h: number, uvScale = 0.25) {
    const toV = (r: Ring) => { const o: THREE.Vector2[] = []; for (let k = 0; k < r.length; k += 2) o.push(new THREE.Vector2(r[k], r[k + 1])); return o; };
    const contour = toV(outer), hs = holes.map(toV);
    const verts = contour.concat(...hs);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, hs)) {
      this.triUp(verts[a].x, verts[a].y, h, verts[b].x, verts[b].y, h, verts[c].x, verts[c].y, h, uvScale);
    }
  }

  /** Axis-aligned (in a rotated frame) box: center, half sizes, yaw (radians CCW in map). */
  box(cx: number, cy: number, h0: number, hx: number, hy: number, height: number, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corner = (dx: number, dy: number): [number, number] => [cx + dx * c - dy * s, cy + dx * s + dy * c];
    const pts = [corner(-hx, -hy), corner(hx, -hy), corner(hx, hy), corner(-hx, hy)];
    const ring = pts.flat();
    this.ringWalls(ring, h0, h0 + height);
    this.polygon(ring, [], h0 + height);
  }

  mesh(mat: THREE.Material, castShadow = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    return m;
  }

  /** Positions and indices for a trimesh collider. */
  collider() {
    const positions = new Float32Array(this.pos);
    const indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    return { positions, indices };
  }
}
