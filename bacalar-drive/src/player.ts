import * as THREE from 'three';
import type { Physics } from './physics/physics';
import type { World } from './world/world';
import type { Vehicle } from './vehicles/vehicle';
import { OnFoot } from './vehicles/onfoot';
import type { Hud } from './ui/hud';

/**
 * Owns the vehicles and the walking character, and handles switching (1/2/3),
 * entering / exiting (E) and resetting (R).
 */
export class Player {
  readonly vehicles: Vehicle[] = [];
  readonly walker: OnFoot;
  active: Vehicle | null = null;
  readonly root = new THREE.Group();

  constructor(private physics: Physics, private world: World, private hud: Hud) {
    this.walker = new OnFoot(physics);
    this.root.add(this.walker.object);
    this.walker.setEnabled(false);
  }

  add(v: Vehicle) {
    this.vehicles.push(v);
    this.root.add(v.object);
    v.object.visible = false;
    v.setEnabled(false);
    (v as Vehicle & { spawned?: boolean }).spawned = false;
  }

  private isSpawned(v: Vehicle) { return (v as Vehicle & { spawned?: boolean }).spawned === true; }
  private markSpawned(v: Vehicle) {
    (v as Vehicle & { spawned?: boolean }).spawned = true;
    v.object.visible = true;
    v.setEnabled(true);
  }

  /** Map position (x east, y north) of whatever the player controls. */
  focus(): { x: number; y: number; h: number } {
    const p = this.active ? this.active.position() : this.walker.position();
    return { x: p.x, y: -p.z, h: p.y };
  }

  heading() { return this.active ? this.active.heading() : this.walker.heading(); }

  enter(v: Vehicle) {
    this.active = v;
    this.walker.setEnabled(false);
  }

  /** Drop a vehicle at a map position and put the player in it. */
  spawnInto(v: Vehicle, x: number, y: number, h: number, heading: number) {
    this.physics.ensure(x, y);
    this.markSpawned(v);
    v.place(x, y, h, heading);
    this.enter(v);
  }

  exit() {
    const v = this.active;
    if (!v) return;
    const f = this.focus();
    const hd = v.heading();
    const field = this.world.field;
    // try the left side, then the right side, then behind
    const tries: [number, number][] = [[-2.4, 0], [2.4, 0], [0, -4]];
    for (const [side, back] of tries) {
      const x = f.x + Math.cos(hd) * side + Math.sin(hd) * back;
      const y = f.y - Math.sin(hd) * side + Math.cos(hd) * back;
      if (field.shoreDist(x, y) > 0.5 || v.kind === 'land') {
        if (v.kind === 'water' && field.shoreDist(x, y) <= 0.5) continue;
        this.leaveTo(v, x, y);
        return;
      }
    }
    if (v.kind === 'water') {
      // find the nearest land within 25 m
      const land = this.nearestLand(f.x, f.y, 25);
      if (land) { this.leaveTo(v, land[0], land[1]); return; }
      this.hud.message('Too far from the shore to get out');
    }
  }

  private leaveTo(v: Vehicle, x: number, y: number) {
    this.physics.ensure(x, y);
    const h = Math.max(this.world.field.heightAt(x, y), this.groundAt(x, y) ?? -Infinity) + 0.1;
    this.walker.setEnabled(true);
    this.walker.place(x, y, h, v.heading());
    v.controls = { throttle: 0, steer: 0, handbrake: true };
    this.active = null;
  }

  private groundAt(x: number, y: number) { return this.physics.groundHeight(x, -y); }

  nearestLand(x: number, y: number, radius: number): [number, number] | null {
    const field = this.world.field;
    for (let r = 2; r <= radius; r += 2) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, py = y + Math.sin((a / 16) * Math.PI * 2) * r;
        if (field.shoreDist(px, py) > 1.5) return [px, py];
      }
    }
    return null;
  }

  /** Nearest spawned vehicle within range of the walking player. */
  nearestVehicle(range = 6): Vehicle | null {
    const p = this.walker.position();
    let best: Vehicle | null = null, bd = range;
    for (const v of this.vehicles) {
      if (!this.isSpawned(v)) continue;
      const d = v.position().distanceTo(p);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Summon a vehicle next to the player and get in. Returns an error message or null. */
  summon(v: Vehicle): string | null {
    if (this.active === v) return null;
    const f = this.focus();
    const hd = this.heading();
    const field = this.world.field;
    if (v.kind === 'water') {
      const spot = this.findWater(f.x, f.y, 600);
      if (!spot) return 'No lagoon within 600 m. Drive closer to the water.';
      this.spawnInto(v, spot.x, spot.y, 0, spot.heading);
      return null;
    }
    // land vehicle: nearest road point, offset so it does not overlap the current vehicle
    const road = this.world.roads.nearest(f.x, f.y, 600, (r) => r.src.cls !== 'path');
    let x = f.x, y = f.y, heading = hd;
    if (this.active?.kind === 'water' || field.shoreDist(f.x, f.y) < 1) {
      if (!road) return 'No road nearby';
      x = road.x; y = road.y; heading = Math.atan2(road.dx, road.dy);
    } else if (this.active) {
      x = f.x + Math.cos(hd) * 3.6;
      y = f.y - Math.sin(hd) * 3.6;
      if (field.shoreDist(x, y) < 2) { x = f.x - Math.cos(hd) * 3.6; y = f.y + Math.sin(hd) * 3.6; }
    }
    this.physics.ensure(x, y);
    const g = this.groundAt(x, y) ?? field.heightAt(x, y);
    this.spawnInto(v, x, y, g + 0.6, heading);
    return null;
  }

  /** Find a water spot at least 6 m from shore, near the player. */
  findWater(x: number, y: number, radius: number) {
    const field = this.world.field;
    for (let r = 0; r <= radius; r += 6) {
      const steps = Math.max(8, Math.floor(r / 3));
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
        if (field.shoreDist(px, py) < -6 && field.waterKind(px, py) === 1) {
          // point the bow away from the shore
          const e = 4;
          const gx = field.shoreDist(px + e, py) - field.shoreDist(px - e, py);
          const gy = field.shoreDist(px, py + e) - field.shoreDist(px, py - e);
          return { x: px, y: py, heading: Math.atan2(-gx, -gy) };
        }
      }
    }
    return null;
  }

  reset() {
    const v = this.active;
    const f = this.focus();
    if (!v) {
      const road = this.world.roads.nearest(f.x, f.y, 300);
      if (road) this.walker.place(road.x, road.y, road.h + 0.2, this.heading());
      return;
    }
    if (v.kind === 'water') {
      const spot = this.findWater(f.x, f.y, 300);
      if (spot) v.place(spot.x, spot.y, 0, v.heading());
      return;
    }
    const road = this.world.roads.nearest(f.x, f.y, 150, (r) => r.src.cls !== 'path');
    let heading = v.heading();
    if (road) {
      const rh = Math.atan2(road.dx, road.dy);
      // keep the direction closest to the current heading
      heading = Math.cos(rh - heading) >= 0 ? rh : rh + Math.PI;
      this.physics.ensure(road.x, road.y);
      v.place(road.x, road.y, road.h + 0.8, heading);
    } else {
      v.place(f.x, f.y, f.h + 1.5, heading);
    }
  }

  /** Disable bodies whose tile has no colliders so parked vehicles do not fall. */
  updateParked() {
    for (const v of this.vehicles) {
      if (!this.isSpawned(v)) continue;
      if (v === this.active) { v.setEnabled(true); continue; }
      const p = v.position();
      v.setEnabled(this.physics.hasColliderAt(p.x, -p.z));
    }
  }
}
