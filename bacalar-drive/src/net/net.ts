import * as THREE from 'three';
import type { Field } from '../world/field';
import { jeepModel, motoTaxiModel, sportBikeModel } from '../vehicles/models';

/** Server address: set VITE_MP_URL at build time, or ?mp=wss://host in the page address. */
export function serverUrl(): string | null {
  const q = new URLSearchParams(location.search).get('mp');
  const env = (import.meta.env.VITE_MP_URL as string | undefined) ?? '';
  // served by the Worker itself: rooms live at the same address
  const same = location.hostname.endsWith('.workers.dev') ? `wss://${location.host}` : '';
  const url = q || env || same || (location.hostname === 'localhost' ? 'ws://localhost:8787' : DEFAULT_SERVER);
  return url ? url.replace(/\/$/, '') : null;
}

/** Public server on Cloudflare Workers (free plan). */
const DEFAULT_SERVER = 'wss://bacalar-drive.bacalar-drive-server.workers.dev';

export const PHRASES = ['¡Hola!', '¡Carrera al gym!', '¡Espérame!', '¡Buena!', 'Jajaja', '¡Nos vemos en el Jungle Gym!', '¡Cuidado!', 'GG'];

export function randomRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

type State = [number, number, number, number, number]; // x, y, h, heading, speed
interface PlayerInfo { id: number; name: string; veh: number; p: State }

interface Remote {
  info: PlayerInfo;
  object: THREE.Group;
  label: THREE.Sprite;
  /** snapshots with local receive time (s) */
  buf: { t: number; p: State }[];
  bubble: THREE.Sprite | null;
  bubbleUntil: number;
  x: number; y: number;
}

const COLORS = ['#e63946', '#3a86ff', '#ffbe0b', '#8338ec', '#fb5607', '#06d6a0', '#ff70a6', '#70d6ff'];

function textSprite(text: string, color: string, bg = 'rgba(20, 24, 28, 0.85)') {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '900 30px system-ui, sans-serif';
  const w = Math.min(312, g.measureText(text).width + 36);
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(160 - w / 2, 4, w, 56, 16); g.fill();
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 160, 34, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(2.75, 0.55, 1);
  s.layers.set(1);
  return s;
}

/**
 * Connection to a room plus the other players' vehicles. Each client simulates its own car
 * and sends its state about 10 times a second; remote cars are drawn 120 ms in the past and
 * interpolated between snapshots so they move smoothly.
 */
export class Net {
  readonly group = new THREE.Group();
  readonly remotes = new Map<number, Remote>();
  room = '';
  myId = 0;
  status: 'off' | 'connecting' | 'online' | 'reconnecting' | 'full' = 'off';
  onStatus: (s: Net['status']) => void = () => undefined;
  onChat: (name: string, text: string) => void = () => undefined;
  onRoster: () => void = () => undefined;
  private ws: WebSocket | null = null;
  private name = 'Jugador';
  private veh = 0;
  private sendTimer = 0;
  private last: State | null = null;
  private retry = 0;
  private wantOpen = false;

  constructor(private base: string, private field: Field) {}

  join(room: string, name: string, veh: number) {
    this.room = room; this.name = name; this.veh = veh;
    this.wantOpen = true;
    this.retry = 0;
    this.open();
  }

  leave() {
    this.wantOpen = false;
    this.ws?.close();
    this.ws = null;
    for (const id of [...this.remotes.keys()]) this.remove(id);
    this.setStatus('off');
  }

  private setStatus(s: Net['status']) { this.status = s; this.onStatus(s); }

  private open() {
    this.setStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${this.base}/room/${this.room}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, veh: this.veh }));
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const id of [...this.remotes.keys()]) this.remove(id);
      if (!this.wantOpen || this.status === 'full') return;
      // reconnect with backoff: 1 s, 2 s, 4 s, then every 8 s
      const wait = Math.min(8000, 1000 * 2 ** this.retry++);
      this.setStatus('reconnecting');
      setTimeout(() => { if (this.wantOpen && !this.ws) this.open(); }, wait);
    };
    ws.onerror = () => ws.close();
  }

  private handle(m: { t: string; id?: number; room?: string; players?: PlayerInfo[]; p?: PlayerInfo | State; i?: number }) {
    if (m.t === 'welcome') {
      this.myId = m.id!;
      this.retry = 0;
      this.setStatus('online');
      for (const p of m.players ?? []) this.add(p);
      this.onRoster();
    } else if (m.t === 'full') {
      this.setStatus('full');
      this.wantOpen = false;
    } else if (m.t === 'join') {
      this.add(m.p as PlayerInfo);
      this.onChat((m.p as PlayerInfo).name, 'entró a la sala');
      this.onRoster();
    } else if (m.t === 'leave') {
      const r = this.remotes.get(m.id!);
      if (r) this.onChat(r.info.name, 'salió');
      this.remove(m.id!);
      this.onRoster();
    } else if (m.t === 's') {
      const r = this.remotes.get(m.id!);
      if (r) {
        r.buf.push({ t: performance.now() / 1000, p: m.p as State });
        if (r.buf.length > 12) r.buf.shift();
      }
    } else if (m.t === 'chat') {
      const r = this.remotes.get(m.id!);
      const text = PHRASES[m.i ?? 0];
      if (r && text) { this.bubble(r, text); this.onChat(r.info.name, text); }
    }
  }

  private add(info: PlayerInfo) {
    if (this.remotes.has(info.id)) return;
    const color = COLORS[info.id % COLORS.length];
    const model = info.veh === 1 ? motoTaxiModel(color, false) : info.veh === 2 ? sportBikeModel(color) : jeepModel(color, false);
    const spots = info.veh === 1
      ? [[0, 0.3, -1.3], [-0.56, 0.3, 0.55], [0.56, 0.3, 0.55]]
      : info.veh === 2 ? [[0, 0.32, -0.74], [0, 0.32, 0.7]]
        : [[-0.83, 0.42, -1.45], [0.83, 0.42, -1.45], [-0.83, 0.42, 1.2], [0.83, 0.42, 1.2]];
    for (const [x, y, z] of spots) { const w = model.wheel!.clone(); w.position.set(x, y, z); model.root.add(w); }
    const object = new THREE.Group();
    object.add(model.root);
    const label = textSprite(info.name, color);
    label.position.y = 3.1;
    object.add(label);
    object.visible = false;
    this.group.add(object);
    this.remotes.set(info.id, { info, object, label, buf: [], bubble: null, bubbleUntil: 0, x: info.p[0], y: info.p[1] });
  }

  private remove(id: number) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.group.remove(r.object);
    this.remotes.delete(id);
  }

  private bubble(r: Remote, text: string) {
    if (r.bubble) r.object.remove(r.bubble);
    r.bubble = textSprite(text, '#20252a', 'rgba(255,255,255,0.95)');
    r.bubble.position.y = 3.9;
    r.object.add(r.bubble);
    r.bubbleUntil = performance.now() / 1000 + 3.5;
  }

  chat(i: number) {
    if (this.status === 'online') this.ws?.send(JSON.stringify({ t: 'chat', i }));
  }

  /** Send own state (rate limited) and move the remote cars. */
  update(dt: number, me: { x: number; y: number; h: number; heading: number; speed: number } | null) {
    const now = performance.now() / 1000;
    if (me && this.status === 'online' && this.ws?.readyState === WebSocket.OPEN) {
      this.sendTimer -= dt;
      const p: State = [+me.x.toFixed(2), +me.y.toFixed(2), +me.h.toFixed(2), +me.heading.toFixed(3), +me.speed.toFixed(1)];
      const moved = !this.last || Math.hypot(p[0] - this.last[0], p[1] - this.last[1]) > 0.05 || Math.abs(p[3] - this.last[3]) > 0.01;
      // 10 Hz while moving, once a second when parked (keeps the free plan's request budget)
      if (this.sendTimer <= 0 && (moved || this.sendTimer < -1)) {
        this.sendTimer = 0.1;
        this.last = p;
        this.ws.send(JSON.stringify({ t: 's', p }));
      }
    }
    const renderT = now - 0.12;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let p: State;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > renderT) i--;
      const a = b[Math.max(0, i - 1)], c = b[i];
      if (a === c || c.t <= renderT) {
        // no newer snapshot: extrapolate briefly along the heading, then hold
        const ahead = Math.min(0.25, Math.max(0, renderT - c.t));
        p = [c.p[0] + Math.sin(c.p[3]) * c.p[4] * ahead, c.p[1] + Math.cos(c.p[3]) * c.p[4] * ahead, c.p[2], c.p[3], c.p[4]];
      } else {
        const k = (renderT - a.t) / (c.t - a.t);
        let dh = c.p[3] - a.p[3];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p = [a.p[0] + (c.p[0] - a.p[0]) * k, a.p[1] + (c.p[1] - a.p[1]) * k, a.p[2] + (c.p[2] - a.p[2]) * k, a.p[3] + dh * k, c.p[4]];
      }
      r.x = p[0]; r.y = p[1];
      // the sender reports its chassis height; keep the model on the local ground
      const ground = this.field.heightAt(p[0], p[1]);
      r.object.position.set(p[0], Math.max(ground + 0.12, p[2] - 0.75), -p[1]);
      r.object.rotation.set(0, -p[3], 0);
      r.object.visible = true;
      if (r.bubble && now > r.bubbleUntil) { r.object.remove(r.bubble); r.bubble = null; }
    }
  }

  positions() { return [...this.remotes.values()].map((r) => [r.x, r.y] as [number, number]); }
  names() { return [...this.remotes.values()].map((r) => r.info.name); }
}
