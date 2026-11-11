import * as THREE from 'three';
import type { Poi } from '../data/types';
import type { Field } from '../world/field';
import { BRAND, canvasTexture, drawLogo } from './brand';

/** Category look for map pins: badge color and glyph. */
const CATS: [RegExp, string, string][] = [
  [/restaurant|fast_food|food_court/, '#f4511e', '🍴'],
  [/cafe|ice_cream/, '#8d5a3b', '☕'],
  [/bar|pub|nightclub/, '#8338ec', '🍹'],
  [/hotel|hostel|guest_house|motel|apartment|chalet/, '#1d7fd1', '🛏'],
  [/camp_site|caravan_site/, '#2e7d32', '⛺'],
  [/attraction|viewpoint|artwork|castle|memorial|museum/, '#d81b60', '★'],
  [/fuel/, '#455a64', '⛽'],
  [/pharmacy|clinic|hospital|dentist/, '#e53935', '✚'],
  [/bank|atm/, '#2e7d32', '$'],
  [/school|university/, '#6d4c41', '🎓'],
  [/place_of_worship/, '#5e35b1', '⛪'],
  [/bus_station|taxi|bicycle_rental/, '#00897b', '🚌'],
];

function pinCanvas(name: string, color: string, glyph: string, logo?: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 384;
  const g = c.getContext('2d')!;
  // name plate
  g.font = '800 34px Arial, sans-serif';
  const label = name.length > 22 ? name.slice(0, 21) + '…' : name;
  const tw = Math.min(360, g.measureText(label).width + 36);
  g.fillStyle = 'rgba(18, 26, 32, 0.88)';
  g.beginPath(); g.roundRect(192 - tw / 2, 6, tw, 54, 18); g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 192, 34, 344);
  // pin body
  g.fillStyle = color;
  g.beginPath();
  g.arc(192, 190, 108, Math.PI * 0.82, Math.PI * 0.18);
  g.lineTo(192, 378);
  g.closePath();
  g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  // logo disc
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(192, 190, 78, 0, Math.PI * 2); g.fill();
  if (logo) g.drawImage(logo, 114, 112, 156, 156);
  else {
    g.fillStyle = color;
    g.font = '900 92px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif';
    g.fillText(glyph, 192, 198);
  }
  return c;
}

/**
 * Map-style pins floating above named places, with the place name and a category logo.
 * A small pool of sprites is reassigned to the nearest places as the player moves.
 */
export class Pins {
  readonly group = new THREE.Group();
  private pool: { sprite: THREE.Sprite; poi: Poi | null }[] = [];
  private textures = new Map<Poi, THREE.Texture>();
  private timer = 0;
  readonly gymPin: THREE.Sprite;

  constructor(private pois: Poi[], private field: Field, gym: { x: number; y: number; h: number }, poolSize = 26) {
    for (let i = 0; i < poolSize; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
      sprite.visible = false;
      sprite.center.set(0.5, 0);
      this.group.add(sprite);
      this.pool.push({ sprite, poi: null });
    }
    // the gym gets its own big pin with the real logo, always shown
    const tex = canvasTexture(pinCanvas(BRAND.name, BRAND.lime, '', drawLogo(256)));
    this.gymPin = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
    this.gymPin.center.set(0.5, 0);
    this.gymPin.position.set(gym.x, gym.h + 13, -gym.y);
    this.gymPin.renderOrder = 6;
    this.group.add(this.gymPin);
  }

  private texture(p: Poi) {
    let t = this.textures.get(p);
    if (!t) {
      const cat = CATS.find(([re]) => re.test(p.kind));
      t = canvasTexture(pinCanvas(p.name, cat?.[1] ?? '#546e7a', cat?.[2] ?? '●'));
      this.textures.set(p, t);
      // keep the cache bounded
      if (this.textures.size > 90) {
        const first = this.textures.keys().next().value!;
        if (!this.pool.some((s) => s.poi === first)) { this.textures.get(first)!.dispose(); this.textures.delete(first); }
      }
    }
    return t;
  }

  update(dt: number, x: number, y: number, cam: THREE.Vector3) {
    // gym pin grows with distance so it can be spotted from far away
    const gd = this.gymPin.position.distanceTo(cam);
    const gs = Math.max(9, Math.min(70, gd * 0.09));
    this.gymPin.scale.set(gs, gs, 1);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const near = this.pois
      .map((p) => ({ p, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
      .filter((o) => o.d < 240 * 240)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length)
      .map((o) => o.p);
    const wanted = new Set(near);
    const free = this.pool.filter((s) => !s.poi || !wanted.has(s.poi));
    const shown = new Set(this.pool.filter((s) => s.poi && wanted.has(s.poi)).map((s) => s.poi));
    for (const s of free) { s.poi = null; s.sprite.visible = false; }
    for (const p of near) {
      if (shown.has(p)) continue;
      const slot = free.pop();
      if (!slot) break;
      slot.poi = p;
      const m = slot.sprite.material;
      m.map = this.texture(p);
      m.needsUpdate = true;
      slot.sprite.position.set(p.x, this.field.heightAt(p.x, p.y) + 8.5, -p.y);
      slot.sprite.scale.set(6.5, 6.5, 1);
      slot.sprite.visible = true;
    }
  }
}
