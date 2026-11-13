/**
 * Bacalar Drive multiplayer server: one Durable Object per room, WebSocket hibernation.
 * Runs on the Cloudflare Workers free plan. Clients simulate their own vehicle; the room
 * relays positions, rejects impossible movement and owns room membership.
 *
 * Messages are JSON. Client -> server:
 *   { t: 'hello', name, veh }            join with a nickname and vehicle
 *   { t: 's', p: [x, y, h, heading, speed] }   own state, about 10 times a second
 *   { t: 'chat', i }                     one of the preset phrases
 *   { t: 'start', spots: [[x, y], ...] } start a "Mancuerna de Oro" round
 *   { t: 'bot', i, p }                   state of a bot driven by the host (lowest id)
 * Server -> client:
 *   { t: 'welcome', id, room, players }  { t: 'join', p }  { t: 'leave', id }
 *   { t: 's', id, p }                    { t: 'chat', id, i }  { t: 'full' }
 *   { t: 'g', phase, left, holder, ball, scores }   game state, owned by the server
 */
import { SITE } from './site';

export interface Env { ROOMS: DurableObjectNamespace }

const MAX_PLAYERS = 8;
const MAX_SPEED = 95;          // m/s, well above the fastest vehicle (190 km/h = 53 m/s)
const PHRASES = 8;
const ROUND_MS = 120_000;
const GRAB_M = 4.5;            // distance to pick the dumbbell up from the ground
const STEAL_M = 3.6;           // distance to steal it from its holder
const STEAL_COOLDOWN = 1500;   // ms the new holder is safe
const BOT_ID = 90;
const BOT_NAMES = ['Don Chuy', 'La Güera'];

interface Ent { id: number; name: string; veh: number; x: number; y: number; h: number; hd: number; v: number; at: number }
interface GameState { phase: 'idle' | 'play' | 'over'; ends: number; holder: number; since: number; ball: [number, number]; scores: Map<number, { name: string; pts: number }>; lastTick: number; lastSent: number }

interface Meta { id: number; name: string; veh: number; x: number; y: number; h: number; hd: number; v: number; at: number; strikes: number }

const cors = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{3,10})$/);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    // everything else is the game itself (static files bundled into the Worker)
    // the root is the game picker; the 3D game lives at /index.html
    const f = SITE[url.pathname === '/' ? (SITE['/juegos.html'] ? '/juegos.html' : '/index.html') : url.pathname];
    if (!f) return new Response('not found', { status: 404, headers: cors });
    return new Response(f.body, {
      headers: { 'Content-Type': f.type, 'Cache-Control': f.hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300', ...cors },
    });
  },
};

export class Room {
  private nextId = 1;
  private bots = new Map<number, Ent>();
  private game: GameState = { phase: 'idle', ends: 0, holder: 0, since: 0, ball: [0, 0], scores: new Map(), lastTick: 0, lastSent: 0 };

  constructor(private state: DurableObjectState) {
    // ids must stay unique after the object wakes from hibernation
    for (const ws of state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as Meta | null;
      if (meta) this.nextId = Math.max(this.nextId, meta.id + 1);
    }
  }

  async fetch(req: Request): Promise<Response> {
    const room = new URL(req.url).pathname.split('/').pop()!;
    if (req.headers.get('Upgrade') !== 'websocket') {
      return Response.json({ room, players: this.players().length, max: MAX_PLAYERS }, { headers: cors });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server);
    if (this.players().length >= MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4000, 'room full');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private players(): Meta[] {
    const out: Meta[] = [];
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as Meta | null;
      if (meta) out.push(meta);
    }
    return out;
  }

  private broadcast(msg: unknown, except?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except || !ws.deserializeAttachment()) continue;
      try { ws.send(text); } catch { /* socket already gone */ }
    }
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 1200) return;
    let msg: { t?: string; name?: unknown; veh?: unknown; p?: unknown; i?: unknown; spots?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = ws.deserializeAttachment() as Meta | null;

    if (msg.t === 'hello' && !meta) {
      if (this.players().length >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(4000, 'room full'); return; }
      const name = String(msg.name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Jugador';
      const me: Meta = { id: this.nextId++, name, veh: [0, 1, 2].includes(Number(msg.veh)) ? Number(msg.veh) : 0, x: 0, y: 0, h: 0, hd: 0, v: 0, at: 0, strikes: 0 };
      const others = this.players();
      ws.serializeAttachment(me);
      const room = this.state.id.name ?? '';
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, room, players: [...others, ...this.bots.values()].map(pub) }));
      this.broadcast({ t: 'join', p: pub(me) }, ws);
      if (this.game.phase !== 'idle') ws.send(JSON.stringify(this.gameMsg(Date.now())));
      return;
    }
    if (!meta) return;

    if (msg.t === 's' && Array.isArray(msg.p) && msg.p.length === 5 && msg.p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      const [x, y, h, hd, v] = msg.p as number[];
      const now = Date.now();
      // reject teleports and impossible speeds; three strikes in a row disconnects
      if (meta.at) {
        const dt = Math.max(0.05, (now - meta.at) / 1000);
        if (Math.hypot(x - meta.x, y - meta.y) / dt > MAX_SPEED && dt < 3) {
          meta.strikes++;
          ws.serializeAttachment(meta);
          if (meta.strikes > 30) ws.close(4001, 'movement rejected');
          return;
        }
      }
      meta.strikes = Math.max(0, meta.strikes - 1);
      Object.assign(meta, { x, y, h, hd, v, at: now });
      ws.serializeAttachment(meta);
      this.broadcast({ t: 's', id: meta.id, p: [x, y, h, hd, v] }, ws);
      this.tick(now);
      return;
    }
    // a round whose clock ran out without anyone ticking it is over
    if (this.game.phase === 'play' && Date.now() >= this.game.ends) this.finish(Date.now());
    if (msg.t === 'start' && this.game.phase !== 'play' && Array.isArray((msg as { spots?: unknown }).spots)) {
      const spots = ((msg as { spots: unknown[] }).spots).filter((s): s is [number, number] => Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && Number.isFinite(n))).slice(0, 16);
      if (!spots.length) return;
      const now = Date.now();
      this.game = { phase: 'play', ends: now + Math.max(20, Math.min(180, Number((msg as { secs?: unknown }).secs) || ROUND_MS / 1000)) * 1000, holder: 0, since: now, ball: spots[Math.floor(Math.random() * spots.length)], scores: new Map(), lastTick: now, lastSent: 0 };
      void this.state.storage.setAlarm(this.game.ends);
      this.sendGame(now);
      return;
    }
    if (msg.t === 'bot' && Array.isArray(msg.p) && msg.p.length === 5 && msg.p.every((n) => typeof n === 'number' && Number.isFinite(n)) && (msg.i === 0 || msg.i === 1)) {
      // only the host (lowest id in the room) may drive the bots
      if (meta.id !== Math.min(...this.players().map((p) => p.id))) return;
      const id = BOT_ID + (msg.i as number);
      const [x, y, h, hd, v] = msg.p as number[];
      const known = this.bots.get(id);
      const bot: Ent = { id, name: BOT_NAMES[msg.i as number], veh: msg.i as number, x, y, h, hd, v, at: Date.now() };
      this.bots.set(id, bot);
      if (!known) this.broadcast({ t: 'join', p: pub(bot) });
      this.broadcast({ t: 's', id, p: [x, y, h, hd, v] }, ws);
      this.tick(Date.now());
      return;
    }
    if (msg.t === 'chat' && Number.isInteger(msg.i) && (msg.i as number) >= 0 && (msg.i as number) < PHRASES) {
      this.broadcast({ t: 'chat', id: meta.id, i: msg.i }, ws);
    }
  }

  private ents(): Ent[] {
    return [...this.players().filter((p) => p.at > 0), ...this.bots.values()];
  }

  /** Dumbbell rules: pick up, steal on contact, one point per 0.1 s while holding. */
  private tick(now: number) {
    const g = this.game;
    if (g.phase !== 'play') return;
    if (now >= g.ends) { this.finish(now); return; }
    const ents = this.ents();
    let changed = false;
    const holder = ents.find((e) => e.id === g.holder);
    if (g.holder && !holder) { g.holder = 0; changed = true; }
    if (holder) {
      const s = g.scores.get(holder.id) ?? { name: holder.name, pts: 0 };
      s.pts += (now - g.lastTick) / 100;
      g.scores.set(holder.id, s);
      g.ball = [holder.x, holder.y];
      if (now - g.since > STEAL_COOLDOWN) {
        const thief = ents.find((e) => e.id !== holder.id && Math.hypot(e.x - holder.x, e.y - holder.y) < STEAL_M);
        if (thief) { g.holder = thief.id; g.since = now; changed = true; }
      }
    } else {
      const taker = ents.find((e) => Math.hypot(e.x - g.ball[0], e.y - g.ball[1]) < GRAB_M);
      if (taker) { g.holder = taker.id; g.since = now; changed = true; }
    }
    g.lastTick = now;
    if (changed || now - g.lastSent > 1000) this.sendGame(now);
  }

  private gameMsg(now: number) {
    const g = this.game;
    return {
      t: 'g', phase: g.phase, left: Math.max(0, Math.round((g.ends - now) / 100) / 10), holder: g.holder, ball: g.ball,
      scores: [...g.scores.entries()].map(([id, s]) => ({ id, name: s.name, pts: Math.round(s.pts) })).sort((a, b) => b.pts - a.pts),
    };
  }

  private sendGame(now: number) {
    this.game.lastSent = now;
    this.broadcast(this.gameMsg(now));
  }

  private finish(now: number) {
    if (this.game.phase !== 'play') return;
    this.game.phase = 'over';
    this.game.holder = 0;
    this.sendGame(now);
    for (const id of this.bots.keys()) this.broadcast({ t: 'leave', id });
    this.bots.clear();
  }

  alarm() { this.finish(Date.now()); }

  webSocketClose(ws: WebSocket) { this.gone(ws); }
  webSocketError(ws: WebSocket) { this.gone(ws); }

  private gone(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as Meta | null;
    if (meta) this.broadcast({ t: 'leave', id: meta.id }, ws);
    // bots belong to the host: drop them when the room empties
    if (this.players().filter((p) => p.id !== meta?.id).length === 0) this.bots.clear();
    try { ws.close(); } catch { /* already closed */ }
  }
}

const pub = (m: Ent) => ({ id: m.id, name: m.name, veh: m.veh, p: [m.x, m.y, m.h, m.hd, m.v] });
