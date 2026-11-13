import * as THREE from 'three';
import type { Net, PartyState } from '../net/net';
import type { Race } from './race';
import type { Field } from '../world/field';
import type { RoadNetwork } from '../world/roads';
import type { Hud } from '../ui/hud';
import type { Sound } from '../audio';
import type { Minimap } from '../ui/minimap';

interface Me { x: number; y: number; h: number }
interface Bot { node: number; prev: number; next: number; x: number; y: number; heading: number; send: number }

/**
 * "La Mancuerna de Oro": a golden dumbbell lies somewhere in the center. Whoever carries it
 * scores every tenth of a second; touching the carrier steals it. The server owns the
 * dumbbell, the scores and the clock. With fewer than three people the host adds two bots.
 */
export class Mancuerna {
  readonly group = new THREE.Group();
  private bell: THREE.Group;
  private beam: THREE.Mesh;
  private prevHolder = 0;
  private prevPhase: PartyState['phase'] = 'idle';
  private bots: Bot[] = [];
  onEvent: (kind: 'start' | 'grab' | 'lost') => void = () => undefined;
  onOver: (rows: { name: string; pts: number; me: boolean }[], won: boolean) => void = () => undefined;

  constructor(private net: Net, private race: Race, private field: Field, private roads: RoadNetwork,
    private hud: Hud, private sound: Sound, private minimap: Minimap, private center: { x: number; y: number }) {
    const gold = new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.9, roughness: 0.25, emissive: '#b8860b', emissiveIntensity: 0.6 });
    const bell = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 10), gold);
    bar.rotation.z = Math.PI / 2;
    bell.add(bar);
    for (const s of [-1, 1]) for (const [r, o] of [[0.5, 0.62], [0.38, 0.86]] as const) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.2, 16), gold);
      plate.rotation.z = Math.PI / 2;
      plate.position.x = s * o;
      bell.add(plate);
    }
    this.bell = bell;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 1.4, 160, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beam.layers.set(1);
    this.group.add(bell, this.beam);
    this.group.visible = false;
  }

  /** Road points around the plaza where the dumbbell may appear. */
  start() {
    const spots: [number, number][] = [];
    for (let i = 0; i < 40 && spots.length < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 280;
      const p = this.roads.nearest(this.center.x + Math.cos(a) * r, this.center.y + Math.sin(a) * r, 60, (o) => o.src.cls !== 'path' && o.src.paved);
      if (p && this.field.shoreDist(p.x, p.y) > 8) spots.push([+p.x.toFixed(1), +p.y.toFixed(1)]);
    }
    if (spots.length) this.net.startParty(spots);
  }

  private nameOf(id: number) {
    if (id === this.net.myId) return 'Tú';
    return this.net.remotes.get(id)?.info.name ?? 'Alguien';
  }

  private posOf(id: number, me: Me): [number, number] | null {
    if (id === this.net.myId) return [me.x, me.y];
    const r = this.net.remotes.get(id);
    return r ? [r.x, r.y] : null;
  }

  active() { return this.net.party?.phase === 'play'; }

  /** HUD lines while a round runs. */
  line() {
    const g = this.net.party;
    if (!g || g.phase !== 'play') return '';
    const t = Math.ceil(g.left);
    const mine = g.scores.find((s) => s.id === this.net.myId)?.pts ?? 0;
    const lead = g.scores[0];
    const who = g.holder ? (g.holder === this.net.myId ? '<b>¡La llevas tú!</b>' : `La lleva <b>${this.nameOf(g.holder)}</b>: ¡quítasela!`) : 'Está libre: ¡ve por ella!';
    return `<span class="race-clock">⏱ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span> <span class="race-pos">${mine} pts</span><br>${who}${lead && lead.id !== this.net.myId ? ` · 1º ${lead.name} ${lead.pts}` : ''}`;
  }

  update(dt: number, time: number, me: Me) {
    const g = this.net.party;
    if (!g || g.phase === 'idle') { this.group.visible = false; this.minimap.gold = null; return; }
    if (g.phase === 'play') g.left = Math.max(0, g.left - dt);

    // events
    if (g.phase === 'play' && this.prevPhase !== 'play') { this.hud.showToast('La Mancuerna de Oro', 'tómala y no la sueltes', 3); this.sound.beep(true); this.bots = []; this.onEvent('start'); }
    if (g.holder !== this.prevHolder && g.phase === 'play') {
      if (g.holder === this.net.myId) { this.hud.showToast('¡Es tuya!', 'huye: sumas puntos mientras la lleves', 2.2); this.sound.reward(); this.onEvent('grab'); }
      else if (this.prevHolder === this.net.myId) { this.hud.showToast('¡Te la quitaron!', `la tiene ${this.nameOf(g.holder)}`, 2.2); this.sound.crash(0.4); this.onEvent('lost'); }
      else if (g.holder) this.hud.message(`${this.nameOf(g.holder)} tiene la mancuerna`, 2);
    }
    if (g.phase === 'over' && this.prevPhase === 'play') {
      const rows = g.scores.map((s) => ({ name: s.id === this.net.myId ? `${this.net.name} (tú)` : s.name, pts: s.pts, me: s.id === this.net.myId }));
      if (!rows.some((r) => r.me)) rows.push({ name: `${this.net.name} (tú)`, pts: 0, me: true });
      this.onOver(rows, rows[0]?.me === true && rows[0].pts > 0);
    }
    this.prevHolder = g.holder;
    this.prevPhase = g.phase;
    if (g.phase !== 'play') { this.group.visible = false; this.minimap.gold = null; return; }

    // the dumbbell floats over its spot, or over whoever carries it
    const p = (g.holder ? this.posOf(g.holder, me) : null) ?? g.ball;
    const ground = this.field.heightAt(p[0], p[1]);
    this.group.visible = true;
    this.bell.position.set(p[0], ground + (g.holder ? 3.9 : 1.5) + Math.sin(time * 3) * 0.15, -p[1]);
    this.bell.rotation.y = time * 2.2;
    this.beam.position.set(p[0], ground + 80, -p[1]);
    this.minimap.gold = [p[0], p[1]];

    if (this.net.isHost() && this.net.realPlayers() < 3) this.runBots(dt, g, me);
  }

  // ---- bots, simulated by the host along the street graph ----
  private runBots(dt: number, g: PartyState, me: Me) {
    const gr = this.race.graph;
    if (!this.bots.length) {
      for (let i = 0; i < 2; i++) {
        const n = gr.nearest(this.center.x + (i ? 90 : -90), this.center.y + (i ? 60 : -70), 200);
        if (n < 0) return;
        this.bots.push({ node: n, prev: -1, next: n, x: gr.xs[n], y: gr.ys[n], heading: 0, send: i * 0.1 });
      }
    }
    this.bots.forEach((b, i) => {
      const id = 90 + i;
      const carrying = g.holder === id;
      // where to go: the free dumbbell, the carrier, or away from the nearest chaser
      let tx = g.ball[0], ty = g.ball[1], flee = false;
      if (carrying) {
        flee = true;
        let bd = Infinity;
        const others: [number, number][] = [[me.x, me.y], ...this.net.positions()];
        for (const [ox, oy] of others) {
          const d = Math.hypot(ox - b.x, oy - b.y);
          if (d > 0.5 && d < bd) { bd = d; tx = ox; ty = oy; }
        }
      } else if (g.holder) {
        const hp = this.posOf(g.holder, me);
        if (hp) { tx = hp[0]; ty = hp[1]; }
      }
      const speed = carrying ? 11.5 : 14;
      let nx = gr.xs[b.next], ny = gr.ys[b.next];
      let d = Math.hypot(nx - b.x, ny - b.y);
      if (d < 1.2) {
        const opts = gr.adj[b.next].filter((n) => n !== b.node);
        const pool = opts.length ? opts : gr.adj[b.next];
        let best = pool[0] ?? b.next, bs = flee ? -Infinity : Infinity;
        for (const n of pool) {
          const s = Math.hypot(gr.xs[n] - tx, gr.ys[n] - ty) + Math.random() * 6;
          if (flee ? s > bs : s < bs) { bs = s; best = n; }
        }
        b.prev = b.node; b.node = b.next; b.next = best;
        nx = gr.xs[b.next]; ny = gr.ys[b.next];
        d = Math.hypot(nx - b.x, ny - b.y);
      }
      if (d > 0.01) {
        const step = Math.min(d, speed * dt);
        b.x += ((nx - b.x) / d) * step; b.y += ((ny - b.y) / d) * step;
        let dh = Math.atan2(nx - b.x, ny - b.y) - b.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        b.heading += dh * Math.min(1, dt * 8);
      }
      b.send -= dt;
      if (b.send <= 0) {
        b.send = 0.2;
        this.net.sendBot(i, [+b.x.toFixed(2), +b.y.toFixed(2), +(this.field.heightAt(b.x, b.y) + 0.9).toFixed(2), +b.heading.toFixed(3), speed]);
      }
    });
  }
}
