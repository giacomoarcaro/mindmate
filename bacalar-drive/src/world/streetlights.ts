import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadNetwork } from './roads';
import type { TileGrid } from './tilegrid';
import type { Tile, TileLayer } from './world';
import type { Field } from './field';

interface Lamp { x: number; y: number; h: number; yaw: number }

/** Street lights along primary roads. Lamp heads glow and light pools appear at night. */
export class StreetLights implements TileLayer {
  private byTile = new Map<number, Lamp[]>();
  private poleGeo: THREE.BufferGeometry;
  private headGeo: THREE.BufferGeometry;
  private poolGeo: THREE.BufferGeometry;
  readonly poleMat = new THREE.MeshLambertMaterial({ color: '#7d8287' });
  readonly headMat = new THREE.MeshStandardMaterial({ color: '#fff2c8', emissive: '#ffd27a', emissiveIntensity: 0 });
  readonly poolMat: THREE.MeshBasicMaterial;
  count = 0;

  constructor(roads: RoadNetwork, field: Field, grid: TileGrid) {
    for (const r of roads.roads) {
      if (r.src.cls !== 'primary') continue;
      const pts = r.pts;
      let acc = 0, next = 10, side = 1;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        const seg = Math.hypot(bx - ax, by - ay);
        while (next < acc + seg) {
          const t = (next - acc) / seg;
          const dx = (bx - ax) / seg, dy = (by - ay) / seg;
          const off = r.src.width / 2 + 0.9;
          const x = ax + (bx - ax) * t - dy * off * side, y = ay + (by - ay) * t + dx * off * side;
          const other = roads.nearest(x, y, 15, (o) => o !== r && o.src.cls !== 'path');
          const onOtherRoad = other !== null && other.dist < other.road.src.width / 2 + 0.5;
          if (field.shoreDist(x, y) > 1 && !onOtherRoad) {
            const key = grid.keyAt(x, y);
            let list = this.byTile.get(key);
            if (!list) this.byTile.set(key, (list = []));
            // arm points toward the road
            list.push({ x, y, h: field.heightAt(x, y), yaw: Math.atan2(-dx * side, dy * side) });
            this.count++;
          }
          next += 34;
          side = -side;
        }
        acc += seg;
      }
    }
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 7, 6).translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(1.6, 0.08, 0.08).translate(0.8, 6.9, 0);
    this.poleGeo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()]);
    this.headGeo = new THREE.BoxGeometry(0.55, 0.14, 0.3).translate(1.55, 6.8, 0);
    this.poolGeo = new THREE.CircleGeometry(6.5, 20).rotateX(-Math.PI / 2);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,140,0.85)');
    grad.addColorStop(0.5, 'rgba(255,190,110,0.35)');
    grad.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12,
    });
  }

  setNight(night: number) {
    this.headMat.emissiveIntensity = night * 6;
    this.poolMat.opacity = night * 0.9;
    this.poolMat.visible = night > 0.02;
  }

  build(tile: Tile) {
    const list = this.byTile.get(tile.key);
    if (!list?.length) return;
    const poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, list.length);
    const heads = new THREE.InstancedMesh(this.headGeo, this.headMat, list.length);
    const pools = new THREE.InstancedMesh(this.poolGeo, this.poolMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw);
      m.compose(new THREE.Vector3(l.x, l.h, -l.y), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      // pool centered under the lamp head, on the road
      const hx = l.x + Math.cos(l.yaw) * 1.55, hy = l.y + Math.sin(l.yaw) * 1.55;
      m.compose(new THREE.Vector3(hx, l.h + 0.35, -hy), q, one);
      pools.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    pools.renderOrder = 3;
    pools.layers.set(1);
    for (const im of [poles, heads, pools]) im.computeBoundingSphere();
    tile.group.add(poles, heads, pools);
    const prev = tile.dispose;
    tile.dispose = () => { prev(); poles.dispose(); heads.dispose(); pools.dispose(); };
  }
}
