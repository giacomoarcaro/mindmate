import * as THREE from 'three';

/** Bacalar Jungle Gym brand: one place for colors, facts and drawn logo. */
export const BRAND = {
  name: 'Bacalar Jungle Gym',
  lime: '#b4e23c',
  mint: '#6fe08a',
  peach: '#ff9a5c',
  pink: '#ff5fa2',
  gold: '#ffd23f',
  charcoal: '#20252a',
  lagoon: '#2fb6b8',
  /** Google Maps listing, October 2026 */
  lat: 18.6856156,
  lon: -88.3949969,
  whatsapp: '529837530375',
  whatsappText: 'Hola! Vengo del juego Bacalar Drive y quiero mi primer día gratis en el Jungle Gym',
  rating: '4.8',
  reviews: 204,
  /** From bacalarjunglegym.com (self-reported, verify before a public launch) */
  offer: 'Tu primer día es GRATIS',
  hours: 'Lun a Vie 6:30 a 22:30 · Sáb 7:30 a 15:30',
  price: 'Mensualidad $700 MXN · pase de día para viajeros',
  classes: ['Funcional', 'HIIT', 'Powerlifting', 'Cardio Box', 'Full Body', 'Entrenamiento personal'],
};

export const whatsappUrl = () => `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(BRAND.whatsappText)}`;

function dumbbell(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string) {
  g.fillStyle = color;
  const h = w * 0.16;
  g.fillRect(cx - w / 2, cy - h / 2, w, h);
  for (const s of [-1, 1]) {
    g.fillRect(cx + s * w * 0.5 - w * 0.07, cy - w * 0.26, w * 0.14, w * 0.52);
    g.fillRect(cx + s * w * 0.62 - w * 0.05, cy - w * 0.18, w * 0.1, w * 0.36);
  }
}

/** Round badge: dumbbell over a lagoon, BACALAR on top, JUNGLE GYM pill below. */
export function drawLogo(size = 512): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const R = size / 2;
  g.save();
  g.beginPath(); g.arc(R, R, R * 0.96, 0, Math.PI * 2); g.clip();
  g.fillStyle = BRAND.charcoal; g.fillRect(0, 0, size, size);
  // lagoon bands in the lower half
  const bands = ['#bff3ea', '#7fe0d8', '#3fc6c9', '#1ea3c0', '#1580ae'];
  bands.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(R, size * 1.02, R * (1.25 - i * 0.16), R * (0.62 - i * 0.09), 0, 0, Math.PI * 2);
    g.fill();
  });
  // palm leaves
  g.strokeStyle = BRAND.mint; g.lineWidth = size * 0.03; g.lineCap = 'round';
  for (const [x, dir] of [[size * 0.12, 1], [size * 0.88, -1]] as const) {
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(x, size * 0.62);
      g.quadraticCurveTo(x + dir * size * (0.05 + k * 0.04), size * (0.42 - k * 0.03), x + dir * size * (0.16 + k * 0.03), size * (0.5 + k * 0.05));
      g.stroke();
    }
  }
  g.restore();
  g.lineWidth = size * 0.035; g.strokeStyle = BRAND.lime;
  g.beginPath(); g.arc(R, R, R * 0.94, 0, Math.PI * 2); g.stroke();
  dumbbell(g, R, size * 0.3, size * 0.5, '#f4f4f0');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${size * 0.15}px "Arial Black", Arial, sans-serif`;
  g.lineWidth = size * 0.02; g.strokeStyle = BRAND.charcoal;
  g.strokeText('BACALAR', R, size * 0.5);
  g.fillStyle = '#ffffff'; g.fillText('BACALAR', R, size * 0.5);
  // pill
  const pw = size * 0.6, ph = size * 0.13, px = R - pw / 2, py = size * 0.6;
  g.fillStyle = BRAND.charcoal;
  g.beginPath(); g.roundRect(px, py, pw, ph, ph / 2); g.fill();
  g.font = `900 ${size * 0.085}px "Arial Black", Arial, sans-serif`;
  g.fillStyle = BRAND.lime; g.fillText('JUNGLE GYM', R, py + ph / 2 + size * 0.005);
  return c;
}

/** Wide sign for the facade, billboards and vehicle doors. */
export function drawSign(w = 1024, h = 256, sub = ''): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = BRAND.charcoal; g.fillRect(0, 0, w, h);
  g.fillStyle = BRAND.lime; g.fillRect(0, h - h * 0.07, w, h * 0.07);
  g.drawImage(drawLogo(256), h * 0.08, h * 0.08, h * 0.84, h * 0.84);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `900 ${h * (sub ? 0.3 : 0.36)}px "Arial Black", Arial, sans-serif`;
  g.fillStyle = BRAND.lime;
  g.fillText('BACALAR', h * 1.05, h * (sub ? 0.24 : 0.32));
  g.fillStyle = '#ffffff';
  g.fillText('JUNGLE GYM', h * 1.05, h * (sub ? 0.52 : 0.68));
  if (sub) {
    g.font = `800 ${h * 0.15}px Arial, sans-serif`;
    g.fillStyle = BRAND.gold;
    g.fillText(sub, h * 1.05, h * 0.8);
  }
  return c;
}

/** Tall billboard creative. */
export function drawBillboard(distanceText: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0, '#16302a'); grad.addColorStop(1, BRAND.charcoal);
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  g.drawImage(drawLogo(512), 30, 56, 400, 400);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = BRAND.lime;
  g.font = '900 78px "Arial Black", Arial, sans-serif';
  g.fillText('PRIMER DÍA', 460, 120);
  g.fillStyle = BRAND.gold;
  g.font = '900 120px "Arial Black", Arial, sans-serif';
  g.fillText('GRATIS', 460, 230);
  g.fillStyle = '#ffffff';
  g.font = '800 44px Arial, sans-serif';
  g.fillText('Funcional · HIIT · Pesas', 460, 330);
  g.fillStyle = BRAND.peach;
  g.font = '900 52px "Arial Black", Arial, sans-serif';
  g.fillText(distanceText, 460, 420);
  return c;
}

export function canvasTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
