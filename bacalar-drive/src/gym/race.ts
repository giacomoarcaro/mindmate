import * as THREE from 'three';
import type { RoadNetwork } from '../world/roads';
import type { Field } from '../world/field';
import { RAPIER, GROUP_LAND_VEHICLE, GROUP_PLAYER, GROUP_STATIC, groups, type Physics } from '../physics/physics';
import { jeepModel, motoTaxiModel, type VehicleModel } from '../vehicles/models';

/**
 * Road graph with the driving distance from every node to the gym (Dijkstra from the goal).
 * Rivals follow it downhill; the player's race position comes from the same field.
 */
class RoadGraph {
  xs: number[] = [];
  ys: number[] = [];
  adj: number[][] = [];
  dist = new Float64Array(0);
  private index = new Map<string, number>();
  private hash = new Map<number, number[]>();

  constructor(roads: RoadNetwork) {
    for (const r of roads.roads) {
      if (r.src.cls === 'path') continue;
      let prev = -1;
      for (let i = 0; i < r.pts.length; i += 2) {
        const id = this.node(r.pts[i], r.pts[i + 1]);
        if (prev >= 0 && prev !== id) { this.adj[prev].push(id); this.adj[id].push(prev); }
        prev = id;
      }
    }
  }

  private node(x: number, y: number) {
    const key = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.xs.length;
      this.index.set(key, id);
      this.xs.push(x); this.ys.push(y); this.adj.push([]);
      const h = this.hkey(x, y);
      let l = this.hash.get(h);
      if (!l) this.hash.set(h, (l = []));
      l.push(id);
    }
    return id;
  }

  private hkey(x: number, y: number) { return (Math.floor(x / 25) + 4096) * 8192 + Math.floor(y / 25) + 4096; }

  nearest(x: number, y: number, radius = 60) {
    let best = -1, bd = radius * radius;
    const i0 = Math.floor((x - radius) / 25), i1 = Math.floor((x + radius) / 25);
    const j0 = Math.floor((y - radius) / 25), j1 = Math.floor((y + radius) / 25);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const id of this.hash.get((i + 4096) * 8192 + j + 4096) ?? []) {
        const d = (this.xs[id] - x) ** 2 + (this.ys[id] - y) ** 2;
        if (d < bd && Number.isFinite(this.dist[id] ?? 0)) { bd = d; best = id; }
      }
    }
    return best;
  }

  /** Dijkstra from the goal node over the whole graph. */
  computeFrom(goal: number) {
    const n = this.xs.length;
    const dist = new Float64Array(n).fill(Infinity);
    dist[goal] = 0;
    const heap: [number, number][] = [[0, goal]];
    const push = (e: [number, number]) => {
      heap.push(e);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const v of this.adj[u]) {
        const nd = d + Math.hypot(this.xs[u] - this.xs[v], this.ys[u] - this.ys[v]);
        if (nd < dist[v]) { dist[v] = nd; push([nd, v]); }
      }
    }
    this.dist = dist;
  }

  /** Path from a node to the goal following the distance field. */
  pathFrom(start: number): number[] {
    const out = [start];
    let u = start;
    for (let guard = 0; guard < 20000 && this.dist[u] > 0; guard++) {
      let next = -1, bd = this.dist[u];
      for (const v of this.adj[u]) if (this.dist[v] < bd) { bd = this.dist[v]; next = v; }
      if (next < 0) break;
      out.push(next);
      u = next;
    }
    return out;
  }
}

interface Rival {
  name: string;
  model: VehicleModel;
  object: THREE.Group;
  body: RAPIER.RigidBody;
  path: number[];
  /** cumulative distance along the path */
  cum: number[];
  s: number;
  speed: number;
  top: number;
  lane: number;
  finished: boolean;
  finishTime: number;
  x: number; y: number; heading: number;
}

function labelSprite(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 24, 28, 0.85)';
  g.beginPath(); g.roundRect(4, 4, 248, 56, 16); g.fill();
  g.fillStyle = color;
  g.font = '900 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(2.2, 0.55, 1);
  s.position.y = 3.2;
  return s;
}

/**
 * The race: player and three rivals start at the plaza; first to the Jungle Gym wins.
 * Rivals are kinematic bodies driving the shortest road route with speed limited by the bends.
 */
export class Race {
  readonly group = new THREE.Group();
  private graph: RoadGraph;
  rivals: Rival[] = [];
  readonly routeLength: number;

  constructor(roads: RoadNetwork, private field: Field, private physics: Physics, start: { x: number; y: number }, goal: { x: number; y: number }) {
    this.graph = new RoadGraph(roads);
    const g = this.graph.nearest(goal.x, goal.y, 80);
    this.graph.computeFrom(g);
    const s = this.graph.nearest(start.x, start.y, 80);
    this.routeLength = Number.isFinite(this.graph.dist[s]) ? this.graph.dist[s] : 0;

    const specs: { name: string; model: VehicleModel; top: number; color: string }[] = [
      { name: 'Don Chuy', model: motoTaxiModel('#e63946', false), top: 62, color: '#ff8a80' },
      { name: 'La Güera', model: jeepModel('#3a86ff', false), top: 84, color: '#9cc3ff' },
      { name: 'El Profe', model: motoTaxiModel('#ffbe0b', false), top: 58, color: '#ffe08a' },
    ];
    for (const sp of specs) {
      const object = new THREE.Group();
      object.add(sp.model.root);
      if (sp.model.wheel) {
        const big = sp.name === 'La Güera';
        const spots = big
          ? [[-0.83, 0.42, -1.45], [0.83, 0.42, -1.45], [-0.83, 0.42, 1.2], [0.83, 0.42, 1.2]]
          : [[0, 0.3, -1.3], [-0.56, 0.3, 0.55], [0.56, 0.3, 0.55]];
        for (const [x, y, z] of spots) {
          const w = sp.model.wheel.clone();
          w.position.set(x, y, z);
          sp.model.root.add(w);
        }
      }
      object.add(labelSprite(sp.name, sp.color));
      const body = physics.rw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      physics.rw.createCollider(
        RAPIER.ColliderDesc.cuboid(sp.name === 'La Güera' ? 0.9 : 0.62, 0.6, sp.name === 'La Güera' ? 2.1 : 1.35).setTranslation(0, 0.8, 0)
          .setCollisionGroups(groups(0, 0)).setSensor(true),
        body,
      );
      this.group.add(object);
      this.rivals.push({
        name: sp.name, model: sp.model, object, body, path: [], cum: [0], s: 0, speed: 0, top: sp.top / 3.6,
        lane: 0, finished: false, finishTime: 0, x: 0, y: 0, heading: 0,
      });
    }
    this.group.visible = false;
  }

  /** Line rivals up on the start street, behind or beside the player. */
  reset(start: { x: number; y: number; heading: number }) {
    const fx = Math.sin(start.heading), fy = Math.cos(start.heading);
    const rx = fy, ry = -fx;
    const slots = [[-3.2, -1], [3.2, -1], [0, -7]];
    this.rivals.forEach((r, i) => {
      const [side, back] = slots[i];
      const x = start.x + rx * side + fx * back * 1.2, y = start.y + ry * side + fy * back * 1.2;
      const n = this.graph.nearest(x, y, 80);
      r.path = this.graph.pathFrom(n);
      r.cum = [0];
      for (let k = 1; k < r.path.length; k++) {
        const a = r.path[k - 1], b = r.path[k];
        r.cum.push(r.cum[k - 1] + Math.hypot(this.graph.xs[b] - this.graph.xs[a], this.graph.ys[b] - this.graph.ys[a]));
      }
      r.s = 0; r.speed = 0; r.finished = false; r.finishTime = 0;
      r.lane = (i - 1) * 1.1;
      r.top = r.top * (0.94 + Math.random() * 0.12);
      r.x = x; r.y = y; r.heading = start.heading;
      this.place(r, x, y, start.heading);
    });
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }

  private place(r: Rival, x: number, y: number, heading: number) {
    const h = this.field.heightAt(x, y) + 0.15;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
    r.object.position.set(x, h, -y);
    r.object.quaternion.copy(q);
    r.body.setNextKinematicTranslation({ x, y: h, z: -y });
    r.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  /** Point at distance s along a rival's path. */
  private at(r: Rival, s: number) {
    const { cum, path } = r;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const a = path[k - 1], b = path[Math.min(k, path.length - 1)];
    const seg = cum[k] - cum[k - 1] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[k - 1]) / seg));
    const ax = this.graph.xs[a], ay = this.graph.ys[a], bx = this.graph.xs[b], by = this.graph.ys[b];
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / seg, dy: (by - ay) / seg };
  }

  /** Advance rivals. `racing` false holds them on the grid (countdown). */
  update(dt: number, racing: boolean, time: number) {
    for (const r of this.rivals) {
      const total = r.cum[r.cum.length - 1] ?? 0;
      if (!racing || r.finished) { if (r.finished) r.speed *= Math.exp(-dt * 2); continue; }
      // look ahead to slow down for bends
      const p0 = this.at(r, r.s), p1 = this.at(r, Math.min(total, r.s + 14 + r.speed * 0.8));
      const turn = Math.acos(Math.max(-1, Math.min(1, p0.dx * p1.dx + p0.dy * p1.dy)));
      const target = Math.max(7, r.top * (1 - Math.min(0.75, turn * 0.9)));
      const acc = target > r.speed ? 4.2 : -9;
      r.speed = Math.max(0, r.speed + acc * dt);
      if ((acc > 0 && r.speed > target) || (acc < 0 && r.speed < target)) r.speed = target;
      r.s = Math.min(total, r.s + r.speed * dt);
      const p = this.at(r, r.s);
      const look = this.at(r, Math.min(total, r.s + 4));
      const heading = Math.atan2(look.x - p.x, look.y - p.y);
      // keep slightly to one side so rivals do not overlap
      const x = p.x + Math.cos(heading) * r.lane, y = p.y - Math.sin(heading) * r.lane;
      let dh = heading - r.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.heading += dh * Math.min(1, dt * 6);
      r.x = x; r.y = y;
      this.place(r, x, y, r.heading);
      if (r.s >= total - 1) { r.finished = true; r.finishTime = time; }
    }
  }

  /** Remaining road distance to the gym from a map point. */
  remaining(x: number, y: number) {
    const n = this.graph.nearest(x, y, 120);
    if (n < 0) return Infinity;
    return this.graph.dist[n] + Math.hypot(this.graph.xs[n] - x, this.graph.ys[n] - y);
  }

  rivalRemaining(r: Rival) { return r.finished ? 0 : (r.cum[r.cum.length - 1] ?? 0) - r.s; }

  /** 1-based position of the player among all racers. */
  position(px: number, py: number) {
    const mine = this.remaining(px, py);
    return 1 + this.rivals.filter((r) => this.rivalRemaining(r) < mine).length;
  }

  finishedCount() { return this.rivals.filter((r) => r.finished).length; }

  /** Route polyline (map coords) from a point, for the minimap. */
  routeFrom(x: number, y: number, maxPts = 400) {
    const n = this.graph.nearest(x, y, 120);
    if (n < 0) return [];
    return this.graph.pathFrom(n).slice(0, maxPts).map((id) => [this.graph.xs[id], this.graph.ys[id]] as [number, number]);
  }
}
