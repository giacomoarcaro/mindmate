import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Field, LU_FOREST, LU_PARK, LU_RESIDENTIAL } from './field';
import { TILE } from './tilegrid';
import type { Tile, TileLayer } from './world';
import { rng } from '../render/textures';

/**
 * Instanced low-poly jungle. Each tile gets one InstancedMesh per species and LOD;
 * the near and far meshes share instance buffers and are swapped by tile distance.
 */

function colored(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function jitter(g: THREE.BufferGeometry, amount: number, seed: number) {
  const p = g.getAttribute('position');
  const r = rng(seed);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = cache.get(key);
    if (!o) cache.set(key, (o = [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]));
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}

function broadleaf(lod: number) {
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.28, 3.4, lod ? 3 : 5, 1, true).translate(0, 1.7, 0), '#6b5236');
  if (lod) {
    const crown = colored(new THREE.OctahedronGeometry(2.4).scale(1, 0.8, 1).translate(0, 4.4, 0), '#4f7d2d');
    return mergeGeometries([trunk, crown]);
  }
  const c1 = colored(jitter(new THREE.IcosahedronGeometry(2.3, 0), 0.5, 1).scale(1, 0.8, 1).translate(0, 4.4, 0), '#4f7d2d');
  const c2 = colored(jitter(new THREE.IcosahedronGeometry(1.5, 0), 0.4, 2).translate(0.9, 5.4, 0.4), '#5d8c33');
  return mergeGeometries([trunk, c1, c2]);
}

function tallTree(lod: number) {
  const trunk = colored(new THREE.CylinderGeometry(0.25, 0.45, 8, lod ? 3 : 5, 1, true).translate(0, 4, 0), '#7a6448');
  if (lod) {
    const crown = colored(new THREE.OctahedronGeometry(3.6).scale(1.2, 0.5, 1.2).translate(0, 8.6, 0), '#41692a');
    return mergeGeometries([trunk, crown]);
  }
  const c1 = colored(jitter(new THREE.IcosahedronGeometry(3.4, 0), 0.7, 3).scale(1.3, 0.55, 1.3).translate(0, 8.6, 0), '#41692a');
  const c2 = colored(jitter(new THREE.IcosahedronGeometry(2.2, 0), 0.5, 4).scale(1.2, 0.6, 1.2).translate(-1.5, 7.6, 1.2), '#4c7a2e');
  return mergeGeometries([trunk, c1, c2]);
}

function palm(lod: number) {
  const parts: THREE.BufferGeometry[] = [];
  const segs = lod ? 1 : 4;
  const height = 7;
  // gently curved trunk
  for (let s = 0; s < segs; s++) {
    const y0 = (s / segs) * height, y1 = ((s + 1) / segs) * height;
    const bend = (y: number) => (y / height) ** 2 * 1.2;
    const g = new THREE.CylinderGeometry(0.17, 0.22, y1 - y0, lod ? 3 : 5, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + bend(p.getY(i)));
    parts.push(colored(g, '#8a7656'));
  }
  const fronds = lod ? 5 : 8;
  const topX = 1.2;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + 0.3;
    const len = 3.6;
    const w = 0.55;
    // frond: a bent strip of two quads
    const pts = [
      [0, 0, 0], [len * 0.5, 0.35, -w], [len * 0.5, 0.35, w], [len, -0.9, 0],
    ];
    const pos = lod
      ? [pts[0], pts[1], pts[3], pts[0], pts[3], pts[2]]
      : [pts[0], pts[1], pts[2], pts[1], pts[3], pts[2]];
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(pos.flat());
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.rotateY(a);
    g.rotateZ(0);
    g.translate(topX, height, 0);
    g.computeVertexNormals();
    parts.push(colored(g, f % 2 ? '#5c8a2e' : '#4d7a28'));
  }
  if (!lod) parts.push(colored(new THREE.IcosahedronGeometry(0.35, 0).translate(topX, height - 0.2, 0), '#6b5a2a'));
  return mergeGeometries(parts.map((p) => { if (!p.getAttribute('normal')) p.computeVertexNormals(); return p; }));
}

function bush(lod: number) {
  const g = lod ? new THREE.OctahedronGeometry(1.3) : jitter(new THREE.IcosahedronGeometry(1.4, 0), 0.4, 5);
  return colored(g.scale(1.2, 0.75, 1.2).translate(0, 0.7, 0), '#55802f');
}

interface Species {
  name: string;
  geo: [THREE.BufferGeometry, THREE.BufferGeometry];
  shadow: boolean;
}

export class Vegetation implements TileLayer {
  readonly species: Species[];
  readonly material: THREE.MeshLambertMaterial;
  readonly time = { value: 0 };
  spacing = 6.5;

  constructor(private field: Field) {
    this.species = [
      { name: 'broadleaf', geo: [broadleaf(0), broadleaf(1)], shadow: true },
      { name: 'tall', geo: [tallTree(0), tallTree(1)], shadow: true },
      { name: 'palm', geo: [palm(0), palm(1)], shadow: true },
      { name: 'bush', geo: [bush(0), bush(1)], shadow: false },
    ];
    for (const s of this.species) for (const g of s.geo) g.computeVertexNormals();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const time = this.time;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.06 * max(0.0, position.y - 2.0);
          transformed.x += sway;
          transformed.z += sway * 0.6;
        #endif`,
      );
    };
  }

  /** Free land with no other tag counts as jungle; forests are densest, town and parks sparse. */
  private density(lu: number) {
    if (lu === LU_FOREST) return 0.95;
    if (lu === LU_RESIDENTIAL) return 0.12;
    if (lu === LU_PARK) return 0.25;
    return 0.85;
  }

  build(tile: Tile) {
    const r = rng(tile.key * 7919 + 17);
    const field = this.field;
    const lists: number[][] = this.species.map(() => []);
    const sp = this.spacing;
    const n = Math.floor(TILE / sp);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = tile.ox + (i + r()) * sp, y = tile.oy + (j + r()) * sp;
      const sd = field.shoreDist(x, y);
      if (sd < 3) continue;
      if (field.isOccupied(x, y)) continue;
      const lu = field.landuseAt(x, y);
      if (r() > this.density(lu)) continue;
      let s: number;
      const palmP = sd < 70 ? 0.55 : lu === LU_RESIDENTIAL || lu === LU_PARK ? 0.45 : 0.07;
      const roll = r();
      if (roll < palmP) s = 2;
      else if (roll < palmP + (1 - palmP) * 0.25) s = 1;
      else s = 0;
      const h = field.heightAt(x, y) - 0.15;
      const scale = s === 2 ? 0.8 + r() * 0.45 : 0.75 + r() * 0.7;
      lists[s].push(x, h, y, scale, r() * Math.PI * 2, r());
      // undergrowth
      if (lu !== LU_RESIDENTIAL && lu !== LU_PARK && r() < 0.4) {
        const bx = x + (r() - 0.5) * sp, by = y + (r() - 0.5) * sp;
        if (!field.isOccupied(bx, by) && field.shoreDist(bx, by) > 2) {
          lists[3].push(bx, field.heightAt(bx, by) - 0.1, by, 0.6 + r() * 0.8, r() * Math.PI * 2, r());
        }
      }
    }

    // shuffle so that drawing only the first N instances thins the forest evenly (far LOD)
    for (const L of lists) {
      const n6 = L.length / 6;
      for (let i = n6 - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        for (let k = 0; k < 6; k++) { const t = L[i * 6 + k]; L[i * 6 + k] = L[j * 6 + k]; L[j * 6 + k] = t; }
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const meshes: { near: THREE.InstancedMesh; far: THREE.InstancedMesh; total: number; bush: boolean }[] = [];
    this.species.forEach((s, si) => {
      const L = lists[si];
      const count = L.length / 6;
      if (!count) return;
      const near = new THREE.InstancedMesh(s.geo[0], this.material, count);
      const far = new THREE.InstancedMesh(s.geo[1], this.material, count);
      for (let k = 0; k < count; k++) {
        const o = k * 6;
        p.set(L[o], L[o + 1], -L[o + 2]);
        q.setFromAxisAngle(up, L[o + 4]);
        sc.setScalar(L[o + 3]);
        m.compose(p, q, sc);
        near.setMatrixAt(k, m);
        const v = L[o + 5];
        col.setRGB(0.8 + v * 0.35, 0.85 + v * 0.3, 0.75 + (1 - v) * 0.3);
        near.setColorAt(k, col);
      }
      far.instanceMatrix = near.instanceMatrix;
      far.instanceColor = near.instanceColor;
      near.computeBoundingSphere();
      far.boundingSphere = near.boundingSphere;
      near.castShadow = s.shadow;
      near.receiveShadow = far.receiveShadow = false;
      far.castShadow = false;
      near.visible = tile.lod === 0;
      far.visible = tile.lod !== 0;
      tile.group.add(near, far);
      meshes.push({ near, far, total: count, bush: s.name === 'bush' });
    });
    const apply = (lod: number) => {
      for (const o of meshes) {
        o.near.visible = lod === 0;
        o.far.visible = lod !== 0 && !(lod === 2 && o.bush);
        o.far.count = lod === 2 ? Math.ceil(o.total * 0.5) : o.total;
      }
    };
    apply(tile.lod);
    const prev = tile.setLod;
    tile.setLod = (lod) => { prev?.(lod); apply(lod); };
    const prevDispose = tile.dispose;
    tile.dispose = () => { prevDispose(); for (const o of meshes) o.near.dispose(); };
  }
}
