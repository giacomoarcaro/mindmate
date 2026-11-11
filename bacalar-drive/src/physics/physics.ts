import RAPIER from '@dimforge/rapier3d-compat';
import type { Tile, World } from '../world/world';

export { RAPIER };

/** Collision groups: membership in high 16 bits, filter in low 16 bits. */
export const GROUP_STATIC = 0x0001;
export const GROUP_WATERWALL = 0x0002;
export const GROUP_LAND_VEHICLE = 0x0004;
export const GROUP_BOAT = 0x0008;
export const GROUP_PLAYER = 0x0010;
export const groups = (member: number, filter: number) => (member << 16) | filter;

/**
 * Rapier world plus streaming of static tile colliders around the player.
 * Only tiles within PHYSICS_RADIUS (Chebyshev) of the focus get colliders.
 */
export class Physics {
  static async create(world: World) {
    await RAPIER.init();
    return new Physics(world);
  }

  readonly rw: RAPIER.World;
  private tileColliders = new Map<number, { body: RAPIER.RigidBody }>();
  private acc = 0;
  readonly step = 1 / 60;
  physicsRadius = 1;

  private constructor(private world: World) {
    this.rw = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.rw.timestep = this.step;
    world.onTileUnloaded = (t) => this.removeTile(t.key);
  }

  /** Make sure colliders exist around a map position; loads world tiles synchronously if needed. */
  ensure(x: number, y: number, radius = this.physicsRadius) {
    const g = this.world.grid;
    const cx = g.tx(x), cy = g.ty(y);
    const keep = new Set<number>();
    for (let j = cy - radius; j <= cy + radius; j++) for (let i = cx - radius; i <= cx + radius; i++) {
      if (i < 0 || j < 0 || i >= g.ntx || j >= g.nty) continue;
      const k = g.key(i, j);
      keep.add(k);
      if (!this.world.tiles.has(k)) this.world.loadTileNow(k);
      if (!this.tileColliders.has(k)) this.addTile(this.world.tiles.get(k)!);
    }
    return keep;
  }

  /** Called every frame: keep colliders around the focus points, drop the rest. */
  update(focus: { x: number; y: number }[]) {
    const keep = new Set<number>();
    for (const f of focus) for (const k of this.ensure(f.x, f.y)) keep.add(k);
    for (const k of [...this.tileColliders.keys()]) if (!keep.has(k)) this.removeTile(k);
  }

  hasColliderAt(x: number, y: number) {
    return this.tileColliders.has(this.world.grid.keyAt(x, y));
  }

  private addTile(tile: Tile) {
    const body = this.rw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const m of tile.colliders.meshes) {
      if (!m.indices.length) continue;
      const desc = RAPIER.ColliderDesc.trimesh(m.positions, m.indices)
        .setFriction(0.9)
        .setCollisionGroups(groups(GROUP_STATIC, 0xffff));
      this.rw.createCollider(desc, body);
    }
    for (const b of tile.colliders.boxes) {
      const q = { x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) };
      const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation(q)
        .setFriction(0.3)
        .setCollisionGroups(groups(GROUP_WATERWALL, GROUP_LAND_VEHICLE | GROUP_BOAT | GROUP_PLAYER));
      this.rw.createCollider(desc, body);
    }
    this.tileColliders.set(tile.key, { body });
  }

  private removeTile(key: number) {
    const t = this.tileColliders.get(key);
    if (!t) return;
    this.rw.removeRigidBody(t.body);
    this.tileColliders.delete(key);
  }

  /** Fixed-step simulation; `pre` runs before every substep (vehicle controllers). */
  advance(dt: number, pre: (h: number) => void) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < 4) {
      pre(this.step);
      this.rw.step();
      this.acc -= this.step;
      n++;
    }
    if (n === 4) this.acc = 0;
    return this.acc / this.step;
  }

  /** Ray cast straight down against static geometry. Returns hit height or null. */
  groundHeight(x: number, z: number, fromY = 200): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.rw.castRay(ray, 400, true, undefined, groups(GROUP_PLAYER, GROUP_STATIC));
    return hit ? fromY - hit.timeOfImpact : null;
  }
}
