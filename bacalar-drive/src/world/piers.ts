import * as THREE from 'three';
import type { MapData } from '../data/types';
import type { Field } from './field';
import type { TileGrid } from './tilegrid';
import type { Tile, TileLayer } from './world';
import { MeshBuilder, centroidOf, toCCW } from './geom';
import { densify } from './roads';
import { woodTexture } from '../render/textures';

const DECK = 0.85;

/** Wooden piers (muelles) from OSM man_made=pier, merged per tile. */
export class PierLayer implements TileLayer {
  private byTile = new Map<number, MapData['piers']>();
  readonly material: THREE.MeshLambertMaterial;

  constructor(data: MapData, private field: Field, grid: TileGrid) {
    this.material = new THREE.MeshLambertMaterial({ map: woodTexture(), vertexColors: true });
    for (const p of data.piers) {
      const [cx, cy] = centroidOf(p.pts);
      const k = grid.keyAt(cx, cy);
      let l = this.byTile.get(k);
      if (!l) this.byTile.set(k, (l = []));
      l.push(p);
    }
  }

  private deckHeight(x: number, y: number) {
    return Math.max(DECK, this.field.heightAt(x, y) + 0.25);
  }

  build(tile: Tile) {
    const list = this.byTile.get(tile.key);
    if (!list?.length) return;
    const b = new MeshBuilder();
    const posts: [number, number][] = [];
    for (const p of list) {
      if (p.area && p.pts.length >= 6) {
        const ring = toCCW(p.pts);
        const [cx, cy] = centroidOf(ring);
        const h = this.deckHeight(cx, cy);
        b.color('#c9a27a');
        b.polygon(ring, [], h, 0.5);
        b.color('#7a5a3a');
        b.ringWalls(ring, h - 0.3, h, ring, 0.5);
        const n = ring.length / 2;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * k2], by = ring[2 * k2 + 1];
          const len = Math.hypot(bx - ax, by - ay);
          for (let d = 0; d < len; d += 3) posts.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
        }
      } else {
        const pts = densify(p.pts, 3);
        const w = p.width / 2;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const nx = (-(by - ay) / len) * w, ny = ((bx - ax) / len) * w;
          const ha = this.deckHeight(ax, ay), hb = this.deckHeight(bx, by);
          b.color('#c9a27a');
          b.triUp(ax + nx, ay + ny, ha, ax - nx, ay - ny, ha, bx - nx, by - ny, hb, 0.5);
          b.triUp(ax + nx, ay + ny, ha, bx - nx, by - ny, hb, bx + nx, by + ny, hb, 0.5);
          posts.push([ax + nx, ay + ny], [ax - nx, ay - ny]);
        }
      }
    }
    b.color('#5b4128');
    for (const [x, y] of posts) {
      const h = this.deckHeight(x, y);
      const ground = Math.min(this.field.heightAt(x, y), -0.5);
      b.box(x, y, ground - 0.5, 0.1, 0.1, h - ground + 0.4);
    }
    const mesh = b.mesh(this.material);
    mesh.userData.ownedByTile = true;
    tile.group.add(mesh);
  }
}
