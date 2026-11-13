/**
 * Bacalar Drive multiplayer server: one Durable Object per room, WebSocket hibernation.
 * Runs on the Cloudflare Workers free plan. Clients simulate their own vehicle; the room
 * relays positions, rejects impossible movement and owns room membership.
 *
 * Messages are JSON. Client -> server:
 *   { t: 'hello', name, veh }            join with a nickname and vehicle
 *   { t: 's', p: [x, y, h, heading, speed] }   own state, about 10 times a second
 *   { t: 'chat', i }                     one of the preset phrases
 * Server -> client:
 *   { t: 'welcome', id, room, players }  { t: 'join', p }  { t: 'leave', id }
 *   { t: 's', id, p }                    { t: 'chat', id, i }  { t: 'full' }
 */
import { SITE } from './site';

export interface Env { ROOMS: DurableObjectNamespace }

const MAX_PLAYERS = 8;
const MAX_SPEED = 95;          // m/s, well above the fastest vehicle (190 km/h = 53 m/s)
const PHRASES = 8;

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
    if (typeof raw !== 'string' || raw.length > 400) return;
    let msg: { t?: string; name?: unknown; veh?: unknown; p?: unknown; i?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = ws.deserializeAttachment() as Meta | null;

    if (msg.t === 'hello' && !meta) {
      if (this.players().length >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(4000, 'room full'); return; }
      const name = String(msg.name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Jugador';
      const me: Meta = { id: this.nextId++, name, veh: [0, 1, 2].includes(Number(msg.veh)) ? Number(msg.veh) : 0, x: 0, y: 0, h: 0, hd: 0, v: 0, at: 0, strikes: 0 };
      const others = this.players();
      ws.serializeAttachment(me);
      const room = this.state.id.name ?? '';
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, room, players: others.map(pub) }));
      this.broadcast({ t: 'join', p: pub(me) }, ws);
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
      return;
    }
    if (msg.t === 'chat' && Number.isInteger(msg.i) && (msg.i as number) >= 0 && (msg.i as number) < PHRASES) {
      this.broadcast({ t: 'chat', id: meta.id, i: msg.i }, ws);
    }
  }

  webSocketClose(ws: WebSocket) { this.gone(ws); }
  webSocketError(ws: WebSocket) { this.gone(ws); }

  private gone(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as Meta | null;
    if (meta) this.broadcast({ t: 'leave', id: meta.id }, ws);
    try { ws.close(); } catch { /* already closed */ }
  }
}

const pub = (m: Meta) => ({ id: m.id, name: m.name, veh: m.veh, p: [m.x, m.y, m.h, m.hd, m.v] });
