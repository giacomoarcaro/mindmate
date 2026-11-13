import type { MapData } from '../data/types';
import type { RoadNetwork } from './roads';
import type { TileGrid } from './tilegrid';
import type { Tile, TileLayer } from './world';
import type { Field } from './field';

interface Wall { x: number; y: number; len: number; yaw: number }

/**
 * Invisible walls along water polygon edges. They keep cars out of the lagoon and the
 * boat inside it. Edges crossed by a road (bridges) and the map clip border are skipped.
 */
export class WaterWalls implements TileLayer {
  private byTile = new Map<number, Wall[]>();

  constructor(data: MapData, field: Field, roads: RoadNetwork, private grid: TileGrid) {
    const b = data.meta.bounds;
    const onBorder = (x: number, y: number) =>
      x < b.minX + 25 || x > b.maxX - 25 || y < b.minY + 25 || y > b.maxY - 25;
    for (const w of data.water) {
      for (const ring of w.rings) {
        const n = ring.length / 2;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const ax = ring[2 * k], ay = ring[2 * k + 1], bx = ring[2 * k2], by = ring[2 * k2 + 1];
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 0.2) continue;
          const pieces = Math.ceil(len / 15);
          for (let p = 0; p < pieces; p++) {
            const x0 = ax + ((bx - ax) * p) / pieces, y0 = ay + ((by - ay) * p) / pieces;
            const x1 = ax + ((bx - ax) * (p + 1)) / pieces, y1 = ay + ((by - ay) * (p + 1)) / pieces;
            const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
            if (onBorder(mx, my)) continue;
            // skip where a road crosses (bridges, causeways)
            // sample the whole piece: a wall must never poke into a roadway
            const pieceLen = Math.hypot(x1 - x0, y1 - y0);
            let onRoad = false;
            for (let d = 0; d <= pieceLen && !onRoad; d += 1) {
              const px = x0 + ((x1 - x0) * d) / (pieceLen || 1), py = y0 + ((y1 - y0) * d) / (pieceLen || 1);
              const near = roads.nearest(px, py, 12, (r) => r.src.cls !== 'path');
              onRoad = !!near && near.dist < near.road.src.width / 2 + 2.2;
            }
            if (onRoad) continue;
            void field;
            const key = grid.keyAt(mx, my);
            let list = this.byTile.get(key);
            if (!list) this.byTile.set(key, (list = []));
            list.push({ x: mx, y: my, len: len / pieces, yaw: Math.atan2(y1 - y0, x1 - x0) });
          }
        }
      }
    }
  }

  build(tile: Tile) {
    const list = this.byTile.get(tile.key);
    if (!list) return;
    for (const w of list) {
      tile.colliders.boxes.push({ x: w.x, y: -2, z: -w.y, hx: w.len / 2 + 0.3, hy: 4, hz: 0.3, yaw: w.yaw });
    }
  }
}
