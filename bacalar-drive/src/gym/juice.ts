import * as THREE from 'three';

/** Short phone vibration where supported (Android; iOS ignores it). */
export function buzz(ms: number | number[]) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

/** Pooled dust and tire-smoke puffs. */
export class Dust {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private readonly n = 220;

  constructor() {
    this.pos = new Float32Array(this.n * 3).fill(-9999);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(c), color: '#d9cfb8', size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.layers.set(1);
  }

  emit(x: number, y: number, z: number, spread = 0.6) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
    this.pos[i * 3 + 1] = y + Math.random() * 0.3;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.5;
    this.vel[i * 3 + 1] = 0.8 + Math.random() * 1.2;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    this.life[i] = 0.9;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Result card image for sharing (portrait, story format). */
export function shareCard(logo: HTMLCanvasElement, title: string, big: string, sub: string, url: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 1350);
  bg.addColorStop(0, '#235c43'); bg.addColorStop(1, '#10201a');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  const lw = 620, lh = lw * (logo.height / logo.width);
  g.drawImage(logo, 540 - lw / 2, 90, lw, lh);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.font = '900 64px "Arial Black", Arial, sans-serif';
  g.fillText(title, 540, 640, 980);
  g.fillStyle = '#ffd23f'; g.font = '900 230px "Arial Black", Arial, sans-serif';
  g.fillText(big, 540, 850, 1000);
  g.fillStyle = '#b4e23c'; g.font = '900 56px "Arial Black", Arial, sans-serif';
  g.fillText(sub, 540, 1030, 980);
  g.fillStyle = '#ffffff'; g.font = '700 40px Arial, sans-serif';
  g.fillText('¿Me ganas? Juega gratis:', 540, 1170);
  g.fillStyle = '#ffd23f'; g.font = '800 38px Arial, sans-serif';
  g.fillText(url.replace(/^https?:\/\//, ''), 540, 1235, 1000);
  return c;
}
