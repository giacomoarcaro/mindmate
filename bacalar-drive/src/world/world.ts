import * as THREE from 'three';
import type { MapData } from '../data/types';
import { Field } from './field';
import { RoadNetwork, type RoadMat } from './roads';
import { TILE, TileGrid } from './tilegrid';
import { buildFarTerrain, buildTerrainTile } from './terrain';
import { asphaltTexture, concreteTexture, dirtTexture } from '../render/textures';

/** Geometry a tile contributes to the physics world. */
export interface TileColliderData {
  /** triangle soups (positions xyz + indices) */
  meshes: { positions: Float32Array; indices: Uint32Array }[];
  /** axis-aligned or rotated boxes: center (xyz), half extents, yaw */
  boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }[];
}

export interface Tile {
  key: number;
  ox: number;
  oy: number;
  group: THREE.Group;
  colliders: TileColliderData;
  /** LOD level currently shown (0 = near, 1 = far) */
  lod: number;
  setLod?: (lod: number) => void;
  dispose: () => void;
}

/** Extra content per tile (buildings, trees, ...). Registered by later systems. */
export interface TileLayer {
  build(tile: Tile): void;
}

export const LOAD_RADIUS = 3;
export const UNLOAD_RADIUS = 4;

export class World {
  readonly field: Field;
  readonly grid: TileGrid;
  readonly roads: RoadNetwork;
  readonly root = new THREE.Group();
  readonly tiles = new Map<number, Tile>();
  readonly layers: TileLayer[] = [];
  readonly materials: Record<RoadMat, THREE.Material> & { terrain: THREE.Material };
  onTileLoaded?: (t: Tile) => void;
  onTileUnloaded?: (t: Tile) => void;
  private queue: number[] = [];

  constructor(readonly data: MapData) {
    const b = data.meta.bounds;
    this.field = new Field(data);
    this.grid = new TileGrid(b.minX, b.minY, b.maxX, b.maxY);
    this.roads = new RoadNetwork(data, this.field, this.grid);

    const roadMat = (map: THREE.Texture, off: number, color = 0xffffff) => new THREE.MeshLambertMaterial({
      map, color, polygonOffset: true, polygonOffsetFactor: -off, polygonOffsetUnits: -off * 2,
    });
    this.materials = {
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      asphalt: roadMat(asphaltTexture(), 2),
      dirt: roadMat(dirtTexture(), 1),
      concrete: roadMat(concreteTexture(), 1.5),
      marking: new THREE.MeshLambertMaterial({ color: 0xf2f0e6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    };

    const far = new THREE.Mesh(buildFarTerrain(this.field), this.materials.terrain);
    far.name = 'far-terrain';
    far.receiveShadow = false;
    far.matrixAutoUpdate = false;
    this.root.add(far);
  }

  /** Tile keys that should be loaded around a map position, nearest first. */
  private wanted(x: number, y: number, radius: number): number[] {
    const cx = this.grid.tx(x), cy = this.grid.ty(y);
    const out: { k: number; d: number }[] = [];
    for (let j = cy - radius; j <= cy + radius; j++) for (let i = cx - radius; i <= cx + radius; i++) {
      if (i < 0 || j < 0 || i >= this.grid.ntx || j >= this.grid.nty) continue;
      const ox = this.grid.minX + (i + 0.5) * TILE, oy = this.grid.minY + (j + 0.5) * TILE;
      out.push({ k: this.grid.key(i, j), d: Math.hypot(ox - x, oy - y) });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.k);
  }

  /** Call every frame with the focus position (map coords). Builds tiles within a time budget. */
  update(x: number, y: number, budgetMs = 6) {
    const want = this.wanted(x, y, LOAD_RADIUS);
    this.queue = want.filter((k) => !this.tiles.has(k));
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) this.loadTileNow(this.queue.shift()!);

    const cx = this.grid.tx(x), cy = this.grid.ty(y);
    for (const [k, t] of this.tiles) {
      const [i, j] = this.grid.coords(k);
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cy));
      if (cheb > UNLOAD_RADIUS) { this.unloadTile(t); continue; }
      const lod = cheb <= 1 ? 0 : 1;
      if (lod !== t.lod) { t.lod = lod; t.setLod?.(lod); }
    }
  }

  /** Synchronously loads every tile around a point (used at spawn). */
  preload(x: number, y: number, radius = LOAD_RADIUS) {
    for (const k of this.wanted(x, y, radius)) if (!this.tiles.has(k)) this.loadTileNow(k);
    this.update(x, y, 0);
  }

  pendingTiles() { return this.queue.length; }

  loadTileNow(key: number) {
    if (this.tiles.has(key)) return;
    const [ox, oy] = this.grid.origin(key);
    const group = new THREE.Group();
    group.name = `tile-${key}`;
    const disposables: { dispose(): void }[] = [];
    const tile: Tile = {
      key, ox, oy, group, lod: 1,
      colliders: { meshes: [], boxes: [] },
      dispose: () => disposables.forEach((d) => d.dispose()),
    };

    const terr = buildTerrainTile(this.field, ox, oy);
    const tm = new THREE.Mesh(terr.geometry, this.materials.terrain);
    tm.receiveShadow = true;
    group.add(tm);
    disposables.push(terr.geometry);
    tile.colliders.meshes.push({ positions: terr.positions, indices: terr.indices });

    const rb = this.roads.tiles.get(key);
    if (rb) {
      for (const m of ['dirt', 'concrete', 'asphalt', 'marking'] as RoadMat[]) {
        const p = rb.pos[m];
        if (!p.length) continue;
        const g = new THREE.BufferGeometry();
        const pa = new Float32Array(p);
        g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rb.uv[m]), 2));
        const normals = new Float32Array(pa.length);
        for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
        g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, this.materials[m]);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        group.add(mesh);
        disposables.push(g);
        if (m !== 'marking') {
          const idx = new Uint32Array(pa.length / 3);
          for (let i = 0; i < idx.length; i++) idx[i] = i;
          tile.colliders.meshes.push({ positions: pa, indices: idx });
        }
      }
    }

    for (const layer of this.layers) layer.build(tile);

    // collect disposables from layers (geometries owned by the tile)
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && m.userData.ownedByTile && !disposables.includes(m.geometry)) disposables.push(m.geometry);
    });

    group.updateMatrixWorld(true);
    group.traverse((o) => { o.matrixAutoUpdate = false; });
    this.root.add(group);
    this.tiles.set(key, tile);
    this.onTileLoaded?.(tile);
  }

  private unloadTile(t: Tile) {
    this.root.remove(t.group);
    t.dispose();
    this.tiles.delete(t.key);
    this.onTileUnloaded?.(t);
  }
}

/** Converts map coords (x east, y north, h up) into a three.js vector. */
export function toWorld(x: number, y: number, h: number, out = new THREE.Vector3()) {
  return out.set(x, h, -y);
}
